import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { tvdCurrencies, TvdFiatCurrency } from '../tvd.constants';

export type TvdExchangeRateDocument = TvdExchangeRate &
  Document & { _id: Types.ObjectId };

const POSITIVE_DECIMAL_REGEX = /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/;
const immutableRateFields = [
  'currency',
  'bobPerToken',
  'version',
  'effectiveFrom',
  'createdBy',
] as const;

function isPositiveDecimalString(value: string) {
  const normalized = String(value ?? '').trim();
  if (!POSITIVE_DECIMAL_REGEX.test(normalized)) return false;
  const [whole, fraction = ''] = normalized.split('.');
  const units = BigInt(`${whole}${fraction}`.replace(/^0+(?=\d)/, '') || '0');
  return units > 0n;
}

@Schema({ timestamps: true, collection: 'tvd_exchange_rates' })
export class TvdExchangeRate {
  @Prop({
    type: String,
    required: true,
    enum: tvdCurrencies,
    default: 'BOB',
    immutable: true,
  })
  currency: TvdFiatCurrency;

  @Prop({
    type: String,
    required: true,
    trim: true,
    immutable: true,
    validate: {
      validator: isPositiveDecimalString,
      message: 'bobPerToken debe ser positivo',
    },
  })
  bobPerToken: string;

  @Prop({ type: Number, required: true, min: 1, index: true, immutable: true })
  version: number;

  @Prop({ type: Boolean, required: true, default: true, index: true })
  active: boolean;

  @Prop({ type: Date, required: true, index: true, immutable: true })
  effectiveFrom: Date;

  @Prop({ type: Date, default: null, index: true })
  effectiveTo?: Date | null;

  @Prop({ type: String, trim: true, maxlength: 120, default: null })
  idempotencyKey?: string | null;

  @Prop({ type: String, trim: true, maxlength: 80, default: null })
  idempotencyRequestHash?: string | null;

  @Prop({ type: String, trim: true, maxlength: 240, default: null })
  reason?: string | null;

  @Prop({
    type: Types.ObjectId,
    ref: 'RoledUser',
    required: true,
    index: true,
    immutable: true,
  })
  createdBy: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export const TvdExchangeRateSchema =
  SchemaFactory.createForClass(TvdExchangeRate);

TvdExchangeRateSchema.index({ currency: 1, version: 1 }, { unique: true });
TvdExchangeRateSchema.index(
  { currency: 1, active: 1 },
  {
    unique: true,
    partialFilterExpression: { active: true },
  },
);
TvdExchangeRateSchema.index({
  currency: 1,
  active: 1,
  effectiveFrom: 1,
  effectiveTo: 1,
});
TvdExchangeRateSchema.index(
  { idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
  },
);

TvdExchangeRateSchema.pre(
  ['findOneAndUpdate', 'updateOne', 'updateMany'],
  function preventRetroactiveRateMutation() {
    const update = this.getUpdate() as any;
    const directSet = update?.$set ?? update;
    const changesImmutableField = Object.keys(directSet ?? {}).some((key) =>
      immutableRateFields.some((field) => key === field || key.startsWith(`${field}.`)),
    );

    if (changesImmutableField) {
      throw new Error('TVD exchange rate economic fields are immutable');
    }
  },
);
