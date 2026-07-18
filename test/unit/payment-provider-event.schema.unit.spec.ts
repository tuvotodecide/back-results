import { PaymentProviderEventSchema } from '@/modules/payments/schemas/payment-provider-event.schema';

describe('PaymentProviderEventSchema indexes', () => {
  it('declares a single unique eventFingerprint index', () => {
    const indexes = PaymentProviderEventSchema.indexes();
    const eventFingerprintIndexes = indexes.filter(([fields]) => {
      const keys = Object.keys(fields);
      return keys.length === 1 && fields.eventFingerprint === 1;
    });

    expect(eventFingerprintIndexes).toHaveLength(1);
    expect(eventFingerprintIndexes[0]?.[1]).toMatchObject({ unique: true });
  });
});
