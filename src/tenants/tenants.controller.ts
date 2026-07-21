import { Body, Controller, Post } from '@nestjs/common';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { CreatedTenant, TenantsService } from './tenants.service';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Post()
  create(@Body() dto: CreateTenantDto): Promise<CreatedTenant> {
    return this.tenantsService.createTenant(dto);
  }
}
