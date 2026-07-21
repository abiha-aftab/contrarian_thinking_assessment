import {
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class EvaluateBulkDto {
  @IsUUID()
  tenant_id: string;

  @IsIn(['development', 'staging', 'production'])
  environment: 'development' | 'staging' | 'production';

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  user_id: string;

  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;
}

export class EvaluateDto extends EvaluateBulkDto {
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9_-]*$/)
  @MaxLength(100)
  flag_key: string;
}
