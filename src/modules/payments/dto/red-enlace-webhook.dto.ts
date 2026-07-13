import { Type } from 'class-transformer';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class RedEnlaceWebhookClientDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nombreCliente?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  ciCliente?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  numeroCuenta?: string;
}

export class RedEnlaceWebhookBankDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  descripcion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  sigla?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  codigoParticipante?: string;
}

export class RedEnlaceWebhookTransactionsDto {
  @IsOptional()
  @IsNumber()
  monto?: number;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  moneda?: string;

  @IsOptional()
  @IsDateString()
  fechaHoraTransaccion?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => RedEnlaceWebhookClientDto)
  cliente?: RedEnlaceWebhookClientDto;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  numeroAch?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => RedEnlaceWebhookBankDto)
  banco?: RedEnlaceWebhookBankDto;
}

export class RedEnlaceWebhookDto {
  @IsString()
  @MaxLength(80)
  numeroReferencia: string;

  @ValidateIf((dto: RedEnlaceWebhookDto) => !dto.estado)
  @IsString()
  @MaxLength(20)
  codigoRespuesta?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  detalleRespuesta?: string | null;

  @ValidateIf((dto: RedEnlaceWebhookDto) => !dto.codigoRespuesta)
  @IsString()
  @MaxLength(40)
  estado?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  monto?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  moneda?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  achReference?: string;

  @IsOptional()
  @IsDateString()
  fechaPago?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => RedEnlaceWebhookTransactionsDto)
  transacciones?: RedEnlaceWebhookTransactionsDto;
}

export interface RedEnlaceWebhookResponseDto {
  numeroReferencia: string;
  codigoRespuesta: '00' | '05';
  detalleRespuesta: string | null;
}
