import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';

interface RegisteredTenant {
  id: string;
  apiKey: string;
}

describe('tenant isolation and environment scoping (integration)', () => {
  let app: INestApplication;
  let http: App;
  let tenantA: RegisteredTenant;
  let tenantB: RegisteredTenant;
  const flagKey = 'iso-flag';

  async function registerTenant(name: string): Promise<RegisteredTenant> {
    const response = await request(http)
      .post('/api/v1/tenants')
      .send({ name })
      .expect(201);
    return {
      id: response.body.tenant.id as string,
      apiKey: response.body.apiKey as string,
    };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1', {
      exclude: ['health/live', 'health/ready', 'metrics'],
    });
    app.useGlobalPipes(
      new ValidationPipe({
        forbidNonWhitelisted: true,
        transform: true,
        whitelist: true,
      }),
    );
    await app.init();
    http = app.getHttpServer() as App;

    const suffix = Date.now();
    tenantA = await registerTenant(`Isolation A ${suffix}`);
    tenantB = await registerTenant(`Isolation B ${suffix}`);

    await request(http)
      .post(`/api/v1/tenants/${tenantA.id}/flags`)
      .set('Authorization', `Bearer ${tenantA.apiKey}`)
      .send({ key: flagKey, type: 'boolean', defaultValue: false })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('tenant isolation', () => {
    it('rejects requests without an API key', async () => {
      await request(http)
        .get(`/api/v1/tenants/${tenantA.id}/flags`)
        .expect(401);
    });

    it('rejects a garbage API key', async () => {
      await request(http)
        .get(`/api/v1/tenants/${tenantA.id}/flags`)
        .set('Authorization', 'Bearer ffk_AAAAAAAA_notarealkey')
        .expect(401);
    });

    it("blocks tenant B's key from listing tenant A's flags", async () => {
      await request(http)
        .get(`/api/v1/tenants/${tenantA.id}/flags`)
        .set('Authorization', `Bearer ${tenantB.apiKey}`)
        .expect(403);
    });

    it("blocks tenant B's key from mutating tenant A's flags", async () => {
      await request(http)
        .put(`/api/v1/tenants/${tenantA.id}/flags/${flagKey}`)
        .set('Authorization', `Bearer ${tenantB.apiKey}`)
        .send({ defaultValue: true })
        .expect(403);

      await request(http)
        .delete(`/api/v1/tenants/${tenantA.id}/flags/${flagKey}`)
        .set('Authorization', `Bearer ${tenantB.apiKey}`)
        .expect(403);
    });

    it("blocks tenant B's key from evaluating tenant A's flags", async () => {
      await request(http)
        .post('/api/v1/evaluate')
        .set('Authorization', `Bearer ${tenantB.apiKey}`)
        .send({
          tenant_id: tenantA.id,
          environment: 'production',
          user_id: 'user-1',
          flag_key: flagKey,
        })
        .expect(403);
    });

    it("does not leak tenant A's flags into tenant B's list", async () => {
      const response = await request(http)
        .get(`/api/v1/tenants/${tenantB.id}/flags`)
        .set('Authorization', `Bearer ${tenantB.apiKey}`)
        .expect(200);

      const keys = (response.body as { key: string }[]).map((f) => f.key);
      expect(keys).not.toContain(flagKey);
    });

    it('allows the owning tenant full access', async () => {
      const response = await request(http)
        .get(`/api/v1/tenants/${tenantA.id}/flags`)
        .set('Authorization', `Bearer ${tenantA.apiKey}`)
        .expect(200);

      const keys = (response.body as { key: string }[]).map((f) => f.key);
      expect(keys).toContain(flagKey);
    });
  });

  describe('environment scoping', () => {
    beforeAll(async () => {
      await request(http)
        .put(`/api/v1/tenants/${tenantA.id}/flags/${flagKey}`)
        .set('Authorization', `Bearer ${tenantA.apiKey}`)
        .send({ environment: 'staging', enabled: true, rolloutPercentage: 100 })
        .expect(200);
    });

    it('serves the flag only in the environment where it is enabled', async () => {
      const staging = await request(http)
        .post('/api/v1/evaluate')
        .set('Authorization', `Bearer ${tenantA.apiKey}`)
        .send({
          tenant_id: tenantA.id,
          environment: 'staging',
          user_id: 'user-1',
          flag_key: flagKey,
        })
        .expect(200);
      expect(staging.body).toEqual({
        flag_key: flagKey,
        value: true,
        reason: 'rollout',
      });

      const production = await request(http)
        .post('/api/v1/evaluate')
        .set('Authorization', `Bearer ${tenantA.apiKey}`)
        .send({
          tenant_id: tenantA.id,
          environment: 'production',
          user_id: 'user-1',
          flag_key: flagKey,
        })
        .expect(200);
      expect(production.body).toEqual({
        flag_key: flagKey,
        value: false,
        reason: 'disabled',
      });
    });

    it('narrows list responses to the requested environment', async () => {
      const response = await request(http)
        .get(`/api/v1/tenants/${tenantA.id}/flags`)
        .query({ environment: 'staging' })
        .set('Authorization', `Bearer ${tenantA.apiKey}`)
        .expect(200);

      const flag = (
        response.body as {
          key: string;
          environments: Record<string, unknown>;
        }[]
      ).find((f) => f.key === flagKey);
      expect(flag).toBeDefined();
      expect(Object.keys(flag!.environments)).toEqual(['staging']);
    });
  });

  describe('audit trail', () => {
    it('accumulates immutable history across changes', async () => {
      const response = await request(http)
        .get(`/api/v1/tenants/${tenantA.id}/flags/${flagKey}/history`)
        .set('Authorization', `Bearer ${tenantA.apiKey}`)
        .expect(200);

      const actions = (response.body as { action: string }[]).map(
        (entry) => entry.action,
      );
      expect(actions).toContain('created');
      expect(actions).toContain('updated');
    });

    it('exposes no write methods on history', async () => {
      const url = `/api/v1/tenants/${tenantA.id}/flags/${flagKey}/history`;
      await request(http)
        .put(url)
        .set('Authorization', `Bearer ${tenantA.apiKey}`)
        .send({})
        .expect(404);
      await request(http)
        .delete(url)
        .set('Authorization', `Bearer ${tenantA.apiKey}`)
        .expect(404);
    });
  });
});
