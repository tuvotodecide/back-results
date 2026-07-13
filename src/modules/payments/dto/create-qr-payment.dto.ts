import {
  IsEnum,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateQrPaymentDto {
  @IsOptional()
  @IsMongoId()
  tenantId?: string;

  @IsString()
  @Matches(/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/, {
    message: 'amount must be a positive decimal with up to two decimals',
  })
  amount: string;

  @IsEnum(['BOB'])
  currency: 'BOB';

  @IsString()
  @MaxLength(60)
  description: string;
}
