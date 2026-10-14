import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsDefined,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Validate,
  ValidateNested,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import {
  RED_ENLACE_SUCCESS_STATUSES,
  normalizeRedEnlaceStatus,
} from '../utils/payment-status.mapper';

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
  @MaxLength(20)
  codigoBanco?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  nombreBanco?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  numeroOrdenAch?: string;
}

@ValidatorConstraint({
  name: 'RedEnlacePaidTransactionData',
  async: false,
})
class RedEnlacePaidTransactionDataConstraint
  implements ValidatorConstraintInterface
{
  validate(_codigoRespuesta: unknown, args: ValidationArguments) {
    const dto = args.object as RedEnlaceWebhookDto;
    if (
      !RED_ENLACE_SUCCESS_STATUSES.has(
        normalizeRedEnlaceStatus(dto.codigoRespuesta),
      )
    ) {
      return true;
    }

    return (
      dto.monto != null &&
      String(dto.monto).trim().length > 0 &&
      dto.moneda != null &&
      String(dto.moneda).trim().length > 0
    );
  }

  defaultMessage() {
    return 'monto and moneda are required when codigoRespuesta reports a paid QR';
  }
}

/** Notificacion de pago de QR Simple v2. */
export class RedEnlaceWebhookDto {
  /** Referencia de ATC (data.numeroReferencia al generar el QR). */
  @IsDefined()
  @Transform(({ value }) => (value == null ? value : String(value).trim()))
  @IsString()
  @Matches(/^[1-9]\d{0,8}$/)
  @MaxLength(9)
  numeroReferencia: string;

  @IsDefined()
  @Transform(({ value }) => (value == null ? value : String(value).trim()))
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  @Validate(RedEnlacePaidTransactionDataConstraint)
  codigoRespuesta: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  detalleRespuesta?: string;

  @IsOptional()
  @Transform(({ value }) => (value == null ? value : String(value)))
  @IsString()
  @MaxLength(20)
  monto?: string;

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
  clienteOrigen?: RedEnlaceWebhookClientDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => RedEnlaceWebhookBankDto)
  bancoOrigen?: RedEnlaceWebhookBankDto;
}

export interface RedEnlaceWebhookResponseDto {
  numeroReferencia: string;
  codigoRespuesta: '00' | '05';
  detalleRespuesta: string | null;
}
