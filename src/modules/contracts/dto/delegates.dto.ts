import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class UploadDelegatesCsvDto {
  @ApiProperty({ description: 'Contenido del archivo CSV' })
  @IsString()
  @IsNotEmpty()
  csvContent!: string;

  @ApiProperty({ description: 'ID del contrato' })
  @IsMongoId()
  @IsNotEmpty()
  contractId!: string;
}

export class AddDelegateDto {
  @ApiProperty({ description: 'DNI del delegado' })
  @IsString()
  @IsNotEmpty()
  dni!: string;

  @ApiProperty({ description: 'ID del contrato' })
  @IsMongoId()
  @IsNotEmpty()
  contractId!: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  email?: string;
}

export class RemoveDelegateDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  dni!: string;

  @ApiProperty()
  @IsMongoId()
  @IsNotEmpty()
  contractId!: string;
}
