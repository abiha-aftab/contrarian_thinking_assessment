import http from 'k6/http';
import { check } from 'k6';

// Load test for the flag evaluation hot path.
//
// Usage (local server on :3010):
//   docker run --rm -i -e BASE_URL=http://host.docker.internal:3010 \
//     grafana/k6 run - < load/k6-evaluate.js
// or with a local k6 binary:
//   BASE_URL=http://localhost:3010 k6 run load/k6-evaluate.js

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3010';
const API = `${BASE_URL}/api/v1`;

export const options = {
  scenarios: {
    evaluations: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 25),
      duration: __ENV.DURATION || '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{endpoint:evaluate}': ['p(95)<150'],
    'http_req_duration{endpoint:bulk}': ['p(95)<300'],
  },
};

export function setup() {
  const register = http.post(
    `${API}/tenants`,
    JSON.stringify({ name: `Load Test ${Date.now()}` }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(register, { 'tenant registered': (r) => r.status === 201 });
  const { tenant, apiKey } = register.json();

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  const flags = [
    { key: 'load-checkout', type: 'boolean', defaultValue: false },
    { key: 'load-banner', type: 'string', defaultValue: 'control' },
    { key: 'load-limit', type: 'number', defaultValue: 10 },
  ];
  for (const flag of flags) {
    http.post(`${API}/tenants/${tenant.id}/flags`, JSON.stringify(flag), {
      headers,
    });
    http.put(
      `${API}/tenants/${tenant.id}/flags/${flag.key}`,
      JSON.stringify({
        environment: 'production',
        enabled: true,
        rolloutPercentage: 50,
      }),
      { headers },
    );
  }

  return { tenantId: tenant.id, headers };
}

export default function ({ tenantId, headers }) {
  const userId = `user-${__VU}-${Math.floor(Math.random() * 100000)}`;

  // ~90% single evaluations (the hot path), ~10% bulk (SDK bootstrap).
  if (Math.random() < 0.9) {
    const response = http.post(
      `${API}/evaluate`,
      JSON.stringify({
        tenant_id: tenantId,
        environment: 'production',
        user_id: userId,
        flag_key: 'load-checkout',
        context: { country: 'US' },
      }),
      { headers, tags: { endpoint: 'evaluate' } },
    );
    check(response, {
      'evaluate 200': (r) => r.status === 200,
      'has value': (r) => r.json('value') !== undefined,
    });
  } else {
    const response = http.post(
      `${API}/evaluate/bulk`,
      JSON.stringify({
        tenant_id: tenantId,
        environment: 'production',
        user_id: userId,
        context: { country: 'US' },
      }),
      { headers, tags: { endpoint: 'bulk' } },
    );
    check(response, {
      'bulk 200': (r) => r.status === 200,
    });
  }
}
