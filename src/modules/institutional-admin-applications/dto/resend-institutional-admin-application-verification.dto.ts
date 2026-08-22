import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class ResendInstitutionalAdminApplicationVerificationDto {
  @ApiProperty({ example: 'admin@institucion.bo' })
  @IsEmail()
  email: string;
}
