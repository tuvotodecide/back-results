import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { TvdQrAccreditationsService } from '@/modules/tvd/services/tvd-qr-accreditations.service';

const tenantId = new Types.ObjectId();
const assignmentId = new Types.ObjectId();
const userId = new Types.ObjectId();
const paymentId = new Types.ObjectId();
const wallet = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function query<T>(value: T) {
  return { lean: jest.fn().mockResolvedValue(value) };
}

function payment(overrides: Record<string, any> = {}) {
  return {
    _id: paymentId,
    tenantId,
    requestedByUserId: userId,
    targetAssignmentId: assignmentId,
    targetWallet: wallet,
    targetWalletNormalized: wallet.toLowerCase(),
    amountMinor: '1050',
    currency: 'BOB',
    status: 'PAYMENT_CONFIRMED',
    providerReference: '1511556',
    merchantReference: '203414',
    tvdQuote: {
      fiatAmountMinor: '1050',
      fiatCurrency: 'BOB',
      bobPerToken: '2.10',
      exchangeRateVersion: 3,
      tokenAmount: '5',
      tokenAmountSmallestUnit: '500',
      quotedAt: new Date('2026-07-17T10:00:00.000Z'),
    },
    ...overrides,
  };
}

function createHarness(overrides: Record<string, any> = {}) {
  const state = {
    accreditations: [...(overrides.accreditations ?? [])],
    tenant: { _id: tenantId, active: true, ...(overrides.tenant ?? {}) },
    assignment: {
      _id: assignmentId,
      tenantId,
      userId,
      active: true,
      status: 'APPROVED',
      accountAddress: wallet,
      accountAddressNormalized: wallet.toLowerCase(),
      walletVerifiedAt: new Date(),
      walletVerificationSource: 'TEST',
      ...(overrides.assignment ?? {}),
    },
    user: { _id: userId, active: true, ...(overrides.user ?? {}) },
  };
  const accreditationModel = {
    findOne: jest.fn((filter: any) => {
      const found = state.accreditations.find((row: any) => {
        if (filter.sourceType && row.sourceType !== filter.sourceType) return false;
        if (filter.sourceId && row.sourceId !== filter.sourceId) return false;
        return true;
      });
      return query(found ?? null);
    }),
    create: jest.fn(async (doc: any) => {
      if (overrides.duplicateOnCreate) {
        state.accreditations.push({
          _id: new Types.ObjectId(),
          ...doc,
          status: 'PENDING',
          createdAt: new Date(),
        });
        throw { code: 11000 };
      }
      const created = { _id: new Types.ObjectId(), ...doc, createdAt: new Date() };
      state.accreditations.push(created);
      return created;
    }),
  };
  const service = new TvdQrAccreditationsService(
    accreditationModel as any,
    { findById: jest.fn(() => query(state.tenant)) } as any,
    { findById: jest.fn(() => query(state.assignment)) } as any,
    { findById: jest.fn(() => query(state.user)) } as any,
    { record: jest.fn(async () => ({})) } as any,
    { get: jest.fn((key: string) => (key === 'app.tvd.decimals' ? '2' : undefined)) } as unknown as ConfigService,
  );
  return { service, state, accreditationModel };
}

describe('TVD QR accreditations service', () => {
  describe('CASOS POSITIVOS', () => {
    it('TVD-QR-POS-U-003/004/005/006/012 | POSITIVO | UNITARIO | pago confirmado crea QR_PAYMENT PENDING desde snapshot', async () => {
      const { service, state } = createHarness();

      const result = await service.createOrReuseForConfirmedPayment(payment(), {
        source: 'WEBHOOK',
      });

      expect(result).toMatchObject({ status: 'PENDING', reused: false });
      expect(state.accreditations).toHaveLength(1);
      expect(state.accreditations[0]).toMatchObject({
        sourceType: 'QR_PAYMENT',
        sourceId: String(paymentId),
        tenantId,
        targetAssignmentId: assignmentId,
        targetWallet: wallet,
        fiatAmountMinor: '1050',
        fiatCurrency: 'BOB',
        bobPerToken: '2.10',
        exchangeRateVersion: 3,
        tokenAmount: '5',
        tokenAmountSmallestUnit: '500',
        status: 'PENDING',
        attempts: 0,
        createdBy: userId,
      });
    });

    it('TVD-QR-POS-U-007/008 | POSITIVO | UNITARIO | webhook y reconciliacion reutilizan la misma acreditacion', async () => {
      const existing = {
        _id: new Types.ObjectId(),
        sourceType: 'QR_PAYMENT',
        sourceId: String(paymentId),
        tokenAmount: '5',
        status: 'PENDING',
      };
      const { service, accreditationModel } = createHarness({
        accreditations: [existing],
      });

      await expect(
        service.createOrReuseForConfirmedPayment(payment(), { source: 'WEBHOOK' }),
      ).resolves.toMatchObject({ accreditationId: existing._id, reused: true });
      await expect(
        service.createOrReuseForConfirmedPayment(payment(), { source: 'RECONCILIATION' }),
      ).resolves.toMatchObject({ accreditationId: existing._id, reused: true });
      expect(accreditationModel.create).not.toHaveBeenCalled();
    });

    it('TVD-QR-POS-U-009/010 | POSITIVO | UNITARIO | duplicate key concurrente devuelve existente sin blockchain', async () => {
      const { service, accreditationModel } = createHarness({ duplicateOnCreate: true });

      const result = await service.createOrReuseForConfirmedPayment(payment(), {
        source: 'WEBHOOK',
      });

      expect(result).toMatchObject({ status: 'PENDING', reused: true });
      expect(accreditationModel.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('CASOS NEGATIVOS', () => {
    it('TVD-QR-NEG-U-001 | NEGATIVO | UNITARIO | pago no confirmado no crea acreditacion', async () => {
      const { service, accreditationModel } = createHarness();

      await expect(
        service.createOrReuseForConfirmedPayment(payment({ status: 'QR_ACTIVE' }), {
          source: 'WEBHOOK',
        }),
      ).resolves.toMatchObject({
        status: 'BLOCKED_CONFIGURATION',
        reasonCode: 'TVD_PAYMENT_NOT_CONFIRMED',
      });
      expect(accreditationModel.create).not.toHaveBeenCalled();
    });

    it('TVD-QR-NEG-U-002/003/004 | NEGATIVO | UNITARIO | campos congelados ausentes quedan bloqueados sin crear acreditacion utilizable', async () => {
      for (const [override, reasonCode] of [
        [{ tvdQuote: null }, 'TVD_QUOTE_MISSING'],
        [{ targetAssignmentId: null }, 'TVD_PAYMENT_TARGET_ASSIGNMENT_MISSING'],
        [{ targetWallet: null }, 'TVD_PAYMENT_TARGET_WALLET_MISSING'],
      ] as const) {
        const { service } = createHarness();
        await expect(
          service.createOrReuseForConfirmedPayment(payment(override), {
            source: 'WEBHOOK',
          }),
        ).resolves.toMatchObject({ status: 'BLOCKED_CONFIGURATION', reasonCode });
      }
    });

    it('TVD-QR-NEG-U-005/006/007/008/009 | NEGATIVO | UNITARIO | estado actual institucional inconsistente crea bloqueo causal', async () => {
      for (const [overrides, reasonCode] of [
        [{ tenant: { active: false } }, 'TVD_TENANT_INACTIVE'],
        [{ assignment: { active: false } }, 'TVD_ASSIGNMENT_NOT_APPROVED'],
        [{ user: { active: false } }, 'TVD_INSTITUTIONAL_USER_INACTIVE'],
        [{ assignment: { accountAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' } }, 'TVD_WALLET_CHANGED'],
        [{ assignment: { walletVerifiedAt: null } }, 'TVD_WALLET_NOT_VERIFIED'],
        [{ assignment: { walletVerificationSource: null } }, 'TVD_WALLET_NOT_VERIFIED'],
        [{ assignment: { accountAddressNormalized: null } }, 'TVD_WALLET_NOT_VERIFIED'],
      ] as const) {
        const { service } = createHarness(overrides);
        await expect(
          service.createOrReuseForConfirmedPayment(payment(), { source: 'WEBHOOK' }),
        ).resolves.toMatchObject({ status: 'BLOCKED_CONFIGURATION', reasonCode });
      }
    });

    it('TVD-QR-NEG-U-010/011/012/019 | NEGATIVO | UNITARIO | snapshot inconsistente no recalcula tasa vigente', async () => {
      for (const [override, reasonCode] of [
        [{ amountMinor: '9999' }, 'TVD_QUOTE_FIAT_MISMATCH'],
        [{ currency: 'USD' }, 'TVD_QUOTE_FIAT_MISMATCH'],
        [{ tvdQuote: { ...payment().tvdQuote, tokenAmountSmallestUnit: '501' } }, 'TVD_DECIMALS_MISMATCH'],
      ] as const) {
        const { service } = createHarness();
        await expect(
          service.createOrReuseForConfirmedPayment(payment(override), {
            source: 'WEBHOOK',
          }),
        ).resolves.toMatchObject({ status: 'BLOCKED_CONFIGURATION', reasonCode });
      }
    });
  });
});
