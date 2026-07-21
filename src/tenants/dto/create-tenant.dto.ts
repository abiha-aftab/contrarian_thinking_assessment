import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateTenantDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;
}
