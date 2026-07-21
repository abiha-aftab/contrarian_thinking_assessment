import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class TargetingRuleDto {
  @IsString()
  @MaxLength(100)
  attribute: string;

  @IsArray()
  @IsString({ each: true })
  values: string[];
}

export class UpdateFlagDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  defaultValue?: boolean | string | number;

  @IsOptional()
  @IsIn(['development', 'staging', 'production'])
  environment?: 'development' | 'staging' | 'production';

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  rolloutPercentage?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TargetingRuleDto)
  targetingRules?: TargetingRuleDto[];

  @IsOptional()
  variantValue?: boolean | string | number;
}
