import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyInstitutionalAdminApplicationDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  token: string;
}
