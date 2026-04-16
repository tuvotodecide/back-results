import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export class CreateParticipationDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @Length(5, 20)
  @Matches(/^[A-Za-z0-9-]+$/, { message: 'carnet debe ser alfanumerico' })
  carnet: string;

  @ApiPropertyOptional({
    description:
      'Referencia opcional de la sesión presencial QR ya reclamada por la app móvil.',
    example: '684f9d61f4f4b6b9e8c7f123',
  })
  @IsOptional()
  @IsMongoId()
  presentialSessionId?: string;
}
