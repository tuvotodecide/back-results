import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ApproveInstitutionalUserDto {
  @ApiPropertyOptional({
    description:
      'Nombre de institución opcional para sobrescribir el institutionName registrado por el usuario.',
    example: 'Colegio de Ingenieros',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  institutionName?: string;
}

export class PendingInstitutionalUserDto {
  @ApiProperty() id: string;
  @ApiProperty() dni: string;
  @ApiProperty() email: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional() institutionName?: string | null;
  @ApiProperty() emailVerified: boolean;
  @ApiProperty() createdAt: Date;
}

export class ApproveInstitutionalUserResponseDto {
  @ApiProperty() userId: string;
  @ApiProperty() tenantId: string;
  @ApiProperty() tenantName: string;
  @ApiProperty() active: boolean;
}

