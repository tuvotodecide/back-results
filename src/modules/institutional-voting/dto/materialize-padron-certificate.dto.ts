import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsMongoId, IsOptional } from 'class-validator';

export class MaterializePadronCertificateDto {
  @ApiPropertyOptional({
    description: 'Versión específica del padrón. Si se omite, usa la vigente.',
  })
  @IsOptional()
  @IsMongoId()
  padronVersionId?: string;

  @ApiPropertyOptional({
    description: 'Si es true, regenera la constancia aunque ya exista.',
    default: false,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  forceRegenerate?: boolean;
}
