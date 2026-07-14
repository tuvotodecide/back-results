import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsDefined,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Validate,
  ValidateNested,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
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

@ValidatorConstraint({
  name: 'RedEnlaceSuccessTransactionData',
  async: false,
})
class RedEnlaceSuccessTransactionDataConstraint
  implements ValidatorConstraintInterface
{
  validate(
    transacciones: RedEnlaceWebhookTransactionsDto | undefined,
    args: ValidationArguments,
  ) {
    const dto = args.object as RedEnlaceWebhookDto;
    if (dto.estado !== '00') return true;

    return (
      transacciones != null &&
      transacciones.monto != null &&
      transacciones.moneda != null &&
      String(transacciones.moneda).trim().length > 0
    );
  }

  defaultMessage() {
    return 'transacciones, transacciones.monto and transacciones.moneda are required when estado is 00';
  }
}

export class RedEnlaceWebhookDto {
  @IsDefined()
  @Transform(({ value }) => (value == null ? value : String(value)))
  @IsString()
  @MaxLength(80)
  numeroReferencia: string;

  @IsDefined()
  @Transform(({ value }) => (value == null ? value : String(value).trim()))
  @IsString()
  @IsIn(['00', '03', '05'])
  @MaxLength(40)
  estado: string;

  @Validate(RedEnlaceSuccessTransactionDataConstraint)
  @ValidateNested()
  @Type(() => RedEnlaceWebhookTransactionsDto)
  transacciones?: RedEnlaceWebhookTransactionsDto;
}

export interface RedEnlaceWebhookResponseDto {
  numeroReferencia: string;
  codigoRespuesta: '00' | '05';
  detalleRespuesta: string | null;
}
