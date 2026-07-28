import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateInstitutionalAdminInvitationDto {
  @IsString()
  @Length(5, 20)
  @Matches(/^[A-Za-z0-9-]+$/, { message: 'dni debe ser alfanumerico' })
  dni!: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({
    description: 'Motivo visible para el historial de la invitación.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
