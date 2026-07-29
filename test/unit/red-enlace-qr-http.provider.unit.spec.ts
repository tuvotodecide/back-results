import { ConfigService } from '@nestjs/config';
import { PaymentDomainError } from '@/modules/payments/errors/payment-domain.error';
import { RedEnlaceQrHttpProvider } from '@/modules/payments/providers/red-enlace-qr-http.provider';
import { mapRedEnlaceStatus } from '@/modules/payments/utils/payment-status.mapper';

const validQrBase64 = 'UVI=';

const input = {
  merchantReference: '203414',
  amountMinor: '2000',
  currency: 'BOB' as const,
  glosa: '461362|BLOCKCHAIN API QR |7372|PAGO 203414',
  description: 'Recarga institucional',
  expiresAt: new Date('2026-07-14T12:30:00.000Z'),
};

function createProvider(
  http: { post?: jest.Mock; get?: jest.Mock },
  config: Record<string, string | number> = {},
) {
  return new RedEnlaceQrHttpProvider(
    { axiosRef: http } as any,
    {
      get: jest.fn((key: string) => {
        const values: Record<string, string | number> = {
          'app.redEnlace.baseUrl': 'https://red-enlace.test/',
          'app.redEnlace.apiKey': 'outgoing-red-enlace-api-key',
          'app.redEnlace.httpTimeoutMs': 5000,
          'app.redEnlace.qrTtl': '00:30:00',
          ...config,
        };
        return values[key];
      }),
    } as unknown as ConfigService,
  );
}

function generateResponse(override: Record<string, any> = {}) {
  return {
    moneda: 'BOB',
    monto: '20.00',
    origenNumeroReferencia: '203414',
    numeroReferencia: '6780',
    codigoRespuesta: 'PENDING',
    detalleRespuesta: 'Estado en espera de la confirmacion pago QR',
    imagen: validQrBase64,
    ...override,
  };
}

describe('RedEnlaceQrHttpProvider generation parsing', () => {
  async function generate(data: Record<string, any>) {
    const post = jest.fn().mockResolvedValue({ status: 200, data });
    return createProvider({ post }).generateQr(input);
  }

  it('uses codigoRespuesta PENDING as the real provider status', async () => {
    await expect(generate(generateResponse())).resolves.toEqual(
      expect.objectContaining({
        providerReference: '6780',
        originMerchantReference: '203414',
        providerStatus: 'PENDING',
        responseCode: 'PENDING',
        amountMinor: '2000',
        currency: 'BOB',
        qrImage: validQrBase64,
      }),
    );
  });

  it('accepts a valid pure Base64 QR image', async () => {
    await expect(
      generate(generateResponse({ imagen: validQrBase64 })),
    ).resolves.toEqual(
      expect.objectContaining({
        providerStatus: 'PENDING',
        qrImage: validQrBase64,
      }),
    );
  });

  it('accepts a valid Base64 data URI QR image', async () => {
    const dataUri = `data:image/png;base64,${validQrBase64}`;

    await expect(
      generate(generateResponse({ imagen: dataUri })),
    ).resolves.toEqual(
      expect.objectContaining({
        providerStatus: 'PENDING',
        qrImage: dataUri,
      }),
    );
  });

  it('sends monto as an exact decimal string without converting it to Number', async () => {
    const post = jest.fn().mockResolvedValue({
      status: 200,
      data: generateResponse(),
    });

    await createProvider({ post }).generateQr(input);

    expect(post.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        numeroReferencia: 203414,
        monto: '20.00',
      }),
    );
    expect(typeof post.mock.calls[0][1].monto).toBe('string');
  });

  it.each(['ERROR', 'CANCELLED', 'EXPIRED'])(
    'does not force codigoRespuesta %s to PENDING',
    async (codigoRespuesta) => {
      await expect(
        generate(generateResponse({ codigoRespuesta, imagen: undefined })),
      ).resolves.toEqual(
        expect.objectContaining({
          providerStatus: codigoRespuesta,
          responseCode: codigoRespuesta,
          qrImage: '',
        }),
      );
    },
  );

  it('normalizes codigoRespuesta whitespace and case', async () => {
    await expect(
      generate(
        generateResponse({ codigoRespuesta: ' closed ', imagen: undefined }),
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        providerStatus: 'CLOSED',
        responseCode: 'CLOSED',
      }),
    );
  });

  it('rejects an origin reference mismatch', async () => {
    await expect(
      generate(generateResponse({ origenNumeroReferencia: '999999' })),
    ).rejects.toMatchObject({
      code: 'RED_ENLACE_REFERENCE_MISMATCH',
    } satisfies Partial<PaymentDomainError>);
  });

  it('rejects a missing ATC numeroReferencia', async () => {
    await expect(
      generate(generateResponse({ numeroReferencia: undefined })),
    ).rejects.toMatchObject({
      code: 'RED_ENLACE_INVALID_RESPONSE',
    } satisfies Partial<PaymentDomainError>);
  });

  it('rejects amount and currency mismatches', async () => {
    await expect(
      generate(generateResponse({ monto: 21.0 })),
    ).rejects.toMatchObject({
      code: 'RED_ENLACE_AMOUNT_MISMATCH',
    } satisfies Partial<PaymentDomainError>);

    await expect(
      generate(generateResponse({ moneda: 'USD' })),
    ).rejects.toMatchObject({
      code: 'RED_ENLACE_CURRENCY_MISMATCH',
    } satisfies Partial<PaymentDomainError>);
  });

  it('rejects a PENDING response without an image', async () => {
    await expect(
      generate(generateResponse({ imagen: undefined })),
    ).rejects.toMatchObject({
      code: 'RED_ENLACE_INVALID_RESPONSE',
    } satisfies Partial<PaymentDomainError>);
  });

  it('rejects an empty image for PENDING', async () => {
    await expect(
      generate(generateResponse({ imagen: ' ' })),
    ).rejects.toMatchObject({
      code: 'RED_ENLACE_INVALID_RESPONSE',
    } satisfies Partial<PaymentDomainError>);
  });

  it('rejects invalid Base64 for PENDING without logging the image', async () => {
    const consoleLog = jest
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);
    const consoleWarn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const invalidImage = 'not-base64-qr';

    await expect(
      generate(generateResponse({ imagen: invalidImage })),
    ).rejects.toMatchObject({
      code: 'RED_ENLACE_INVALID_RESPONSE',
    } satisfies Partial<PaymentDomainError>);

    expect(consoleLog).not.toHaveBeenCalledWith(
      expect.stringContaining(invalidImage),
    );
    expect(consoleWarn).not.toHaveBeenCalledWith(
      expect.stringContaining(invalidImage),
    );
    consoleLog.mockRestore();
    consoleWarn.mockRestore();
  });

  it('does not require image for ERROR and preserves the real state', async () => {
    await expect(
      generate(
        generateResponse({ codigoRespuesta: 'ERROR', imagen: undefined }),
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        providerStatus: 'ERROR',
        responseCode: 'ERROR',
        qrImage: '',
      }),
    );
  });

  it('rejects a QR image above the configured internal byte limit', async () => {
    const post = jest.fn().mockResolvedValue({
      status: 200,
      data: generateResponse({ imagen: validQrBase64 }),
    });
    const provider = createProvider(
      { post },
      { 'app.redEnlace.maxQrImageBytes': 1 },
    );

    await expect(provider.generateQr(input)).rejects.toMatchObject({
      code: 'RED_ENLACE_INVALID_RESPONSE',
    } satisfies Partial<PaymentDomainError>);
  });

  it('rejects malformed image data URIs for active QR responses', async () => {
    await expect(
      generate(generateResponse({ imagen: 'data:text/plain;base64,UVI=' })),
    ).rejects.toMatchObject({
      code: 'RED_ENLACE_INVALID_RESPONSE',
    } satisfies Partial<PaymentDomainError>);
  });

  it.each(['20.001', '1e3', ' 20.00', '20,00', '100000000.00'])(
    'rejects provider amount %s without rounding or truncation',
    async (monto) => {
      await expect(generate(generateResponse({ monto }))).rejects.toMatchObject(
        {
          code: 'RED_ENLACE_INVALID_RESPONSE',
        } satisfies Partial<PaymentDomainError>,
      );
    },
  );
});

describe('RedEnlaceQrHttpProvider verify parsing', () => {
  async function verify(data: Record<string, any>) {
    const get = jest.fn().mockResolvedValue({ status: 200, data });
    return createProvider({ get }).verifyQr({ providerReference: '6780' });
  }

  it.each([
    ['PENDING'],
    ['SUCCESS'],
    ['CLOSED'],
    ['EXPIRED'],
    ['CANCELLED'],
    ['ERROR'],
    ['NOTFOUND'],
  ])(
    'uses simple codigoRespuesta %s as provider status',
    async (codigoRespuesta) => {
      await expect(
        verify({
          codigoRespuesta,
          detalleRespuesta: `Estado ${codigoRespuesta}`,
        }),
      ).resolves.toEqual(
        expect.objectContaining({
          providerReference: '6780',
          providerStatus: codigoRespuesta,
          responseCode: codigoRespuesta,
        }),
      );
    },
  );

  it('normalizes simple codigoRespuesta whitespace and case', async () => {
    await expect(
      verify({ codigoRespuesta: ' success ', detalleRespuesta: 'Pagado' }),
    ).resolves.toEqual(
      expect.objectContaining({
        providerStatus: 'SUCCESS',
        responseCode: 'SUCCESS',
      }),
    );
  });

  it('parses complete response history and transaction data without exposing PII', async () => {
    const result = await verify({
      codigoRespuesta: ' CLOSED ',
      detalleRespuesta: ' Transaccion cerrada ',
      estados: [
        { estado: ' CLOSED ', fechaHora: '2024-11-29T17:04:41.032' },
        { estado: 'SUCCESS', fechaHora: '2024-11-29T16:04:41.032' },
        { estado: 'PENDING', fechaHora: '2024-11-29T16:01:06.296' },
        { estado: 'INITIALIZE', fechaHora: '2024-11-29T16:01:06.207' },
      ],
      transacciones: {
        monto: 20.0,
        moneda: 'bob',
        fechaHoraTransaccion: '2024-11-29T16:04:41.057',
        cliente: {
          nombreCliente: 'NOMBRE',
          ciCliente: '14240008',
          numeroCuenta: 'CUENTA',
        },
        numeroAch: 'REFERENCIA_ACH',
        banco: {
          descripcion: 'BANCO',
          sigla: 'SIGLA',
          codigoParticipante: 'CODIGO',
        },
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        providerStatus: 'CLOSED',
        responseCode: 'CLOSED',
        responseDetail: 'Transaccion cerrada',
        amountMinor: '2000',
        currency: 'BOB',
        achReference: 'REFERENCIA_ACH',
        paymentDate: new Date('2024-11-29T16:04:41.057'),
        statusHistory: [
          { status: 'CLOSED', at: new Date('2024-11-29T17:04:41.032') },
          { status: 'SUCCESS', at: new Date('2024-11-29T16:04:41.032') },
          { status: 'PENDING', at: new Date('2024-11-29T16:01:06.296') },
          { status: 'INITIALIZE', at: new Date('2024-11-29T16:01:06.207') },
        ],
      }),
    );
    expect(JSON.stringify(result)).not.toContain('NOMBRE');
    expect(JSON.stringify(result)).not.toContain('14240008');
    expect(JSON.stringify(result)).not.toContain('CUENTA');
  });

  it('uses the PDF example order when codigoRespuesta is absent from complete history', async () => {
    await expect(
      verify({
        estados: [
          { estado: 'CLOSED', fechaHora: '2024-11-29T17:04:41.032' },
          { estado: 'SUCCESS', fechaHora: '2024-11-29T16:04:41.032' },
          { estado: 'PENDING', fechaHora: '2024-11-29T16:01:06.296' },
          { estado: 'INITIALIZE', fechaHora: '2024-11-29T16:01:06.207' },
        ],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        providerStatus: 'CLOSED',
        responseCode: undefined,
      }),
    );
  });

  it('does not classify malformed JSON as NOTFOUND', async () => {
    await expect(
      verify({ detalleRespuesta: 'sin estado' }),
    ).rejects.toMatchObject({
      code: 'RED_ENLACE_INVALID_RESPONSE',
    } satisfies Partial<PaymentDomainError>);
  });

  it('maps unknown statuses to PROVIDER_STATUS_UNRESOLVED, not confirmation', () => {
    expect(
      mapRedEnlaceStatus({
        providerStatus: 'UNEXPECTED',
        source: 'RECONCILIATION',
      }),
    ).toEqual(
      expect.objectContaining({
        status: 'PROVIDER_STATUS_UNRESOLVED',
        ambiguous: true,
      }),
    );
  });
});
