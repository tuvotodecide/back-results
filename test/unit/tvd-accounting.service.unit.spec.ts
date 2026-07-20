import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { TvdConversionService } from '@/modules/tvd/services/tvd-conversion.service';
import { TvdQuotesService } from '@/modules/tvd/services/tvd-quotes.service';
import { TokenAccreditationsService } from '@/modules/tvd/services/token-accreditations.service';

const CASE_TYPE_POSITIVE = 'POSITIVO';
const CASE_TYPE_NEGATIVE = 'NEGATIVO';
const LEVEL_UNIT = 'UNITARIO';

describe('TVD accounting conversion and model services', () => {
  const conversion = new TvdConversionService();

  describe('POSITIVOS', () => {
    it('P-UNIT-001 | POSITIVO | UNITARIO | convierte correctamente un monto BOB exacto', () => {
      const result = conversion.convertBobMinorToTvd({
        amountMinor: '1000',
        bobPerToken: '2.50',
        tokenDecimals: 2,
      });

      expect(result).toMatchObject({
        fiatAmountMinor: '1000',
        bobPerToken: '2.5',
        tokenAmount: '4',
        tokenAmountSmallestUnit: '400',
        roundingMode: 'FLOOR',
      });
    });

    it('P-UNIT-002 | POSITIVO | UNITARIO | convierte un monto con resultado decimal', () => {
      const result = conversion.convertBobMinorToTvd({
        amountMinor: '1000',
        bobPerToken: '3',
        tokenDecimals: 2,
      });

      expect(result.tokenAmount).toBe('3.33');
      expect(result.tokenAmountSmallestUnit).toBe('333');
    });

    it('P-UNIT-003 | POSITIVO | UNITARIO | aplica redondeo hacia abajo', () => {
      const result = conversion.convertBobMinorToTvd({
        amountMinor: '100',
        bobPerToken: '3',
        tokenDecimals: 2,
      });

      expect(result.tokenAmount).toBe('0.33');
      expect(result.tokenAmountSmallestUnit).toBe('33');
    });

    it('P-UNIT-011 | POSITIVO | UNITARIO | convierte 10 BOB a 10 TVD con bobPerToken 1 y 18 decimals', () => {
      const result = conversion.convertBobMinorToTvd({
        amountMinor: '1000',
        bobPerToken: '1',
        tokenDecimals: 18,
      });

      expect(result).toMatchObject({
        fiatAmountMinor: '1000',
        bobPerToken: '1',
        tokenAmount: '10',
        tokenAmountSmallestUnit: '10000000000000000000',
        roundingMode: 'FLOOR',
      });
    });

    it('P-UNIT-004/P-UNIT-005/P-UNIT-006 | POSITIVO | UNITARIO | selecciona tasa vigente, conserva version y crea snapshot', async () => {
      const quotedAt = new Date('2026-07-17T12:00:00.000Z');
      const exchangeRates = {
        resolveActiveRateAt: jest.fn().mockResolvedValue({
          bobPerToken: '2.50',
          version: 7,
        }),
      };
      const configService = {
        get: jest.fn((key: string) => (key === 'app.tvd.decimals' ? '2' : undefined)),
      };
      const quotes = new TvdQuotesService(
        exchangeRates as any,
        conversion,
        configService as any,
      );

      const snapshot = await quotes.createPaymentQuoteSnapshot({
        amountMinor: '1000',
        currency: 'BOB',
        quotedAt,
      });

      expect(exchangeRates.resolveActiveRateAt).toHaveBeenCalledWith(quotedAt, 'BOB');
      expect(snapshot).toEqual({
        fiatAmountMinor: '1000',
        fiatCurrency: 'BOB',
        bobPerToken: '2.5',
        exchangeRateVersion: 7,
        tokenAmount: '4',
        tokenAmountSmallestUnit: '400',
        quotedAt,
      });
    });

    it('P-UNIT-008/P-UNIT-009/P-UNIT-010 | POSITIVO | UNITARIO | crea acreditacion pending, normaliza wallet y permite dos origenes', async () => {
      const created: any[] = [];
      const model = {
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn(async (doc) => {
          created.push(doc);
          return { _id: new Types.ObjectId(), ...doc };
        }),
      };
      const service = new TokenAccreditationsService(model as any, conversion);
      const common = {
        sourceId: String(new Types.ObjectId()),
        tenantId: new Types.ObjectId(),
        targetAssignmentId: new Types.ObjectId(),
        targetWallet: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        tokenAmount: '10',
        tokenAmountSmallestUnit: '1000',
        createdBy: new Types.ObjectId(),
      };

      const qr = await service.createPending({
        ...common,
        sourceType: 'QR_PAYMENT',
      });
      const manual = await service.createPending({
        ...common,
        sourceId: String(new Types.ObjectId()),
        sourceType: 'MANUAL_GRANT',
      });

      expect(qr.status).toBe('PENDING');
      expect(manual.status).toBe('PENDING');
      expect(created.map((doc) => doc.sourceType)).toEqual([
        'QR_PAYMENT',
        'MANUAL_GRANT',
      ]);
      expect(created[0].targetWalletNormalized).toBe(
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      );
    });
  });

  describe('NEGATIVOS', () => {
    it.each([
      [
        'N-UNIT-001',
        'rechaza monto BOB cero',
        { amountMinor: '0', bobPerToken: '2', tokenDecimals: 2 },
      ],
      [
        'N-UNIT-002',
        'rechaza monto BOB negativo',
        { amountMinor: '-1', bobPerToken: '2', tokenDecimals: 2 },
      ],
      [
        'N-UNIT-003',
        'rechaza tasa cero',
        { amountMinor: '100', bobPerToken: '0', tokenDecimals: 2 },
      ],
      [
        'N-UNIT-004',
        'rechaza tasa negativa',
        { amountMinor: '100', bobPerToken: '-1', tokenDecimals: 2 },
      ],
      [
        'N-UNIT-005',
        'rechaza tasa con formato invalido',
        { amountMinor: '100', bobPerToken: 'abc', tokenDecimals: 2 },
      ],
      [
        'N-UNIT-006',
        'rechaza conversion que produce cero TVD',
        { amountMinor: '1', bobPerToken: '1000', tokenDecimals: 2 },
      ],
    ])('%s | NEGATIVO | UNITARIO | %s', (_id, _scenario, input) => {
      expect(() => conversion.convertBobMinorToTvd(input)).toThrow(
        BadRequestException,
      );
    });

    it('N-UNIT-007 | NEGATIVO | UNITARIO | rechaza moneda diferente de BOB', async () => {
      const quotes = new TvdQuotesService(
        { resolveActiveRateAt: jest.fn() } as any,
        conversion,
        { get: jest.fn() } as any,
      );

      await expect(
        quotes.createPaymentQuoteSnapshot({
          amountMinor: '100',
          currency: 'USD' as any,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it.each([
      [
        'N-UNIT-008',
        'rechaza sourceType invalido',
        { sourceType: 'UNKNOWN', targetWallet: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', tokenAmount: '1' },
      ],
      [
        'N-UNIT-009',
        'rechaza wallet invalida',
        { sourceType: 'QR_PAYMENT', targetWallet: '0x123', tokenAmount: '1' },
      ],
      [
        'N-UNIT-010',
        'rechaza cantidad TVD invalida',
        { sourceType: 'QR_PAYMENT', targetWallet: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', tokenAmount: '0' },
      ],
    ])('%s | NEGATIVO | UNITARIO | %s', async (_id, _scenario, override) => {
      const model = {
        findOne: jest.fn(),
        create: jest.fn(),
      };
      const service = new TokenAccreditationsService(model as any, conversion);
      await expect(
        service.createPending({
          sourceId: String(new Types.ObjectId()),
          tenantId: new Types.ObjectId(),
          targetAssignmentId: new Types.ObjectId(),
          tokenAmountSmallestUnit: '100',
          createdBy: new Types.ObjectId(),
          ...(override as any),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(model.create).not.toHaveBeenCalled();
    });
  });

  it('documenta metadata minima de casos', () => {
    expect({
      type: CASE_TYPE_POSITIVE,
      level: LEVEL_UNIT,
      negativeType: CASE_TYPE_NEGATIVE,
      rounding: 'FLOOR',
    }).toEqual(
      expect.objectContaining({
        type: 'POSITIVO',
        level: 'UNITARIO',
        negativeType: 'NEGATIVO',
        rounding: 'FLOOR',
      }),
    );
  });
});
