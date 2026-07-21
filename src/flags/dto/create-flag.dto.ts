import {
  IsDefined,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { FlagValueType } from '../value-type.util';

export class CreateFlagDto {
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9_-]*$/, {
    message:
      'key must be lowercase alphanumeric and may contain hyphens or underscores',
  })
  @MaxLength(100)
  key: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsIn(['boolean', 'string', 'number'])
  type: FlagValueType;

  @IsDefined()
  defaultValue: boolean | string | number;
}
