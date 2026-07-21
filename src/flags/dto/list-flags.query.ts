import { IsIn, IsOptional } from 'class-validator';

export class ListFlagsQuery {
  @IsOptional()
  @IsIn(['development', 'staging', 'production'])
  environment?: 'development' | 'staging' | 'production';

  @IsOptional()
  @IsIn(['active', 'archived'])
  status?: 'active' | 'archived';
}
