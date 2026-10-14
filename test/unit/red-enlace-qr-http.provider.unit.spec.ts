import { ConfigService } from '@nestjs/config';
import { PaymentDomainError } from '@/modules/payments/errors/payment-domain.error';
import { RedEnlaceQrHttpProvider } from '@/modules/payments/providers/red-enlace-qr-http.provider';
import { mapRedEnlaceStatus } from '@/modules/payments/utils/payment-status.mapper';

const validQrBase64 = 'UVI=';

const input = {
  merchantReference: '203414',
  amountMinor: '2000',
  currency: 'BOB' as const,
  glosa: 'PAGO 203414',
  description: 'Recarga institucional',
  expiresAt: new Date('2026-07-14T12:30:00.000Z'),
};

const defaultConfig: Record<string, string | number> = {
  'app.redEnlace.baseUrl': 'https://red-enlace.test/sandbox/',
  'app.redEnlace.clientId': 'client-id-test',
  'app.redEnlace.establishmentId': '461362',
  'app.redEnlace.establishmentName': 'BLOCKCHAIN API QR',
  'app.redEnlace.webhookUrl': 'https://api.example.test/api/v1/qr/confirmed',
  'app.redEnlace.callbackToken': 'incoming-callback-token',
  'app.redEnlace.httpTimeoutMs': 5000,
  'app.redEnlace.qrTtl': '00:30:00',
};

function createOAuth(tokens: string[] = ['token-1']) {
  const queue = [...tokens];
  return {
    getAccessToken: jest.fn(() => Promise.resolve(queue.shift() ?? 'token-last')),
    invalidate: jest.fn(),
  };
}

function createLogger() {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

function createProvider(
  http: { post?: jest.Mock; get?: jest.Mock },
  config: Record<string, string | number> = {},
  oauth = createOAuth(),
  logger = createLogger(),
) {
  return new RedEnlaceQrHttpProvider(
    { axiosRef: http } as any,
    {
      get: jest.fn((key: string) => ({ ...defaultConfig, ...config })[key]),
    } as unknown as ConfigService,
    oauth as any,
    logger as any,
  );
}

function generateResponse(override: Record<string, any> = {}) {
  return {
    success: true,
    message: 'QR generado exitosamente',
    data: {
      numeroReferencia: '6780',
      estado: 'PENDIENTE',
      fechaExpiracion: '2026-07-14T08:30:00',
      moneda: 'BOB',
      monto: 20.0,
      numeroReferenciaOriginante: '203414',
      qr: validQrBase64,
      ...override,
    },
  };
}

function verifyResponse(override: Record<string, any> = {}) {
  return {
    success: true,
    message: 'Consulta exitosa',
    data: {
      estado: 'PENDIENTE',
      mensaje: 'QR pendiente de pago',
      importe: 20.0,
      moneda: 'BOB',
      numeroReferenciaOriginante: '203414',
      numeroReferencia: '6780',
      clienteOrigen: { nombreCliente: '', numeroCuenta: '', ciNitCliente: '' },
      bancoOrigen: {
        nombreBanco: '',
        fechaTransaccion: '',
        numeroOrdenAch: '',
        codigoBanco: '',
      },
      ...override,
    },
  };
}

describe('RedEnlaceQrHttpProvider QR Simple v2 request', () => {
  it('generates the QR with the v2 contract and OAuth headers', async () => {
    const post = jest.fn().mockResolvedValue({ status: 200, data: generateResponse() });

    await createProvider({ post }).generateQr(input);

    expect(post).toHaveBeenCalledWith(
      'https://red-enlace.test/sandbox/qr/simple/v2/generate',
      {
        numeroReferencia: '203414',
        glosa: 'PAGO 203414',
        monto: 20,
        moneda: 'BOB',
        vigencia: 1800,
        idEstablecimiento: 461362,
        nombreEstablecimiento: 'BLOCKCHAIN API QR',
        webhook: {
          url: 'https://api.example.test/api/v1/qr/confirmed',
          key: 'x-api-key',
          value: 'incoming-callback-token',
        },
      },
      expect.objectContaining({
        timeout: 5000,
        headers: { access_token: 'token-1', client_id: 'client-id-test' },
      }),
    );
  });

  it('verifies the QR by ATC reference with OAuth headers', async () => {
    const get = jest.fn().mockResolvedValue({ status: 200, data: verifyResponse() });

    await createProvider({ get }).verifyQr({ providerReference: '6780' });

    expect(get).toHaveBeenCalledWith(
      'https://red-enlace.test/sandbox/qr/simple/v2/verify/6780',
      expect.objectContaining({
        headers: { access_token: 'token-1', client_id: 'client-id-test' },
      }),
    );
  });

  it('renews the token and retries once when Red Enlace answers 401', async () => {
    const oauth = createOAuth(['expired-token', 'fresh-token']);
    const post = jest
      .fn()
      .mockResolvedValueOnce({ status: 401, data: {} })
      .mockResolvedValueOnce({ status: 200, data: generateResponse() });

    await expect(
      createProvider({ post }, {}, oauth).generateQr(input),
    ).resolves.toEqual(expect.objectContaining({ providerReference: '6780' }));

    expect(oauth.invalidate).toHaveBeenCalledWith('expired-token');
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1][2].headers).toEqual({
      access_token: 'fresh-token',
      client_id: 'client-id-test',
    });
  });

  it('fails as unauthorized when the renewed token is also rejected', async () => {
    const post = jest.fn().mockResolvedValue({ status: 401, data: {} });

    await expect(
      createProvider({ post }, {}, createOAuth(['a', 'b'])).generateQr(input),
    ).rejects.toMatchObject({
      code: 'RED_ENLACE_UNAUTHORIZED',
    } satisfies Partial<PaymentDomainError>);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('does not call Red Enlace when the establishment is not configured', async () => {
    const post = jest.fn();

    await expect(
      createProvider({ post }, { 'app.redEnlace.establishmentId': '' }).generateQr(
        input,
      ),
    ).rejects.toMatchObject({
      code: 'RED_ENLACE_NOT_CONFIGURED',
    } satisfies Partial<PaymentDomainError>);
    expect(post).not.toHaveBeenCalled();
  });
});

describe('RedEnlaceQrHttpProvider generation parsing', () => {
  async function generate(body: Record<string, any>, status = 200) {
    const post = jest.fn().mockResolvedValue({ status, data: body });
    return createProvider({ post }).generateQr(input);
  }

  it('reads the data envelope and keeps PENDIENTE as provider status', async () => {
    await expect(generate(generateResponse())).resolves.toEqual(
      expect.objectContaining({
        providerReference: '6780',
        originMerchantReference: '203414',
        providerStatus: 'PENDIENTE',
        responseCode: 'PENDIENTE',
        responseDetail: 'QR generado exitosamente',
        amountMinor: '2000',
        currency: 'BOB',
        qrImage: validQrBase64,
      }),
    );
  });

  it('uses fechaExpiracion as Bolivia local time', async () => {
    const result = await generate(generateResponse());

    expect(result.qrExpiresAt).toEqual(new Date('2026-07-14T12:30:00.000Z'));
  });

  it('falls back to the locally computed expiry when fechaExpiracion is invalid', async () => {
    const result = await generate(generateResponse({ fechaExpiracion: 'x' }));

    expect(result.qrExpiresAt).toEqual(input.expiresAt);
  });

  it('accepts a valid Base64 data URI QR image', async () => {
    const dataUri = `data:image/png;base64,${validQrBase64}`;

    await expect(generate(generateResponse({ qr: dataUri }))).resolves.toEqual(
      expect.objectContaining({ qrImage: dataUri }),
    );
  });

  it.each([
    ['2000', 20, '20'],
    ['1050', 10.5, '10.5'],
    ['1', 0.01, '0.01'],
    ['9999999999', 99999999.99, '99999999.99'],
  ])(
    'sends monto %s minor units as the JSON decimal %s without rounding',
    async (amountMinor, monto, json) => {
      const post = jest.fn().mockResolvedValue({ status: 200, data: generateResponse() });

      await createProvider({ post })
        .generateQr({ ...input, amountMinor })
        .catch(() => undefined);

      expect(post.mock.calls[0][1].monto).toBe(monto);
      expect(JSON.stringify(post.mock.calls[0][1])).toContain(`"monto":${json},`);
    },
  );

  it('does not force ERROR to PENDIENTE and does not require an image', async () => {
    await expect(
      generate(generateResponse({ estado: 'ERROR', qr: undefined })),
    ).resolves.toEqual(
      expect.objectContaining({
        providerStatus: 'ERROR',
        responseCode: 'ERROR',
        qrImage: '',
      }),
    );
  });

  it('normalizes estado whitespace and case', async () => {
    await expect(
      generate(generateResponse({ estado: ' pendiente ' })),
    ).resolves.toEqual(expect.objectContaining({ providerStatus: 'PENDIENTE' }));
  });

  it.each([
    ['success false with HTTP 200', { success: false, message: 'Error', errors: [] }, 200],
    [
      'a 400 validation error',
      {
        success: false,
        message: 'Error de validacion',
        errors: [{ field: 'monto', message: 'invalido', code: 'INVALIDO' }],
      },
      400,
    ],
  ])('rejects %s', async (_label, body, status) => {
    await expect(generate(body, status)).rejects.toMatchObject({
      code: 'RED_ENLACE_INVALID_RESPONSE',
    } satisfies Partial<PaymentDomainError>);
  });

  it('logs the rejection status, message and errors without secrets', async () => {
    const logger = createLogger();
    const post = jest.fn().mockResolvedValue({
      status: 400,
      data: {
        success: false,
        message: 'Error de validacion',
        errors: [
          {
            field: 'idEstablecimiento',
            message: 'Establecimiento no registrado',
            code: 'ESTABLECIMIENTO_INVALIDO',
          },
        ],
      },
    });

    await expect(
      createProvider({ post }, {}, createOAuth(), logger).generateQr(input),
    ).rejects.toMatchObject({ code: 'RED_ENLACE_INVALID_RESPONSE' });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [message, context] = logger.warn.mock.calls[0];
    expect(context).toBe('RedEnlaceQrHttpProvider');
    expect(JSON.parse(message)).toEqual({
      event: 'red_enlace_request_rejected',
      operation: 'generate',
      reference: '203414',
      httpStatus: 400,
      success: false,
      message: 'Error de validacion',
      errors: [
        {
          field: 'idEstablecimiento',
          code: 'ESTABLECIMIENTO_INVALIDO',
          message: 'Establecimiento no registrado',
        },
      ],
      bodyKeys: ['success', 'message', 'errors'],
    });
    expect(message).not.toContain('token-1');
    expect(message).not.toContain('incoming-callback-token');
  });

  it('logs the body shape when a 200 response lacks success true', async () => {
    const logger = createLogger();
    const post = jest.fn().mockResolvedValue({
      status: 200,
      data: { success: 'true', data: { qr: validQrBase64 } },
    });

    await expect(
      createProvider({ post }, {}, createOAuth(), logger).generateQr(input),
    ).rejects.toMatchObject({ code: 'RED_ENLACE_INVALID_RESPONSE' });

    const logged = JSON.parse(logger.warn.mock.calls[0][0]);
    expect(logged).toEqual(
      expect.objectContaining({
        httpStatus: 200,
        success: 'true',
        errors: null,
        bodyKeys: ['success', 'data'],
      }),
    );
    expect(logger.warn.mock.calls[0][0]).not.toContain(validQrBase64);
  });

  it('logs a non JSON gateway error body as a truncated message', async () => {
    const logger = createLogger();
    const post = jest
      .fn()
      .mockResolvedValue({ status: 404, data: '<html>Not Found</html>' });

    await expect(
      createProvider({ post }, {}, createOAuth(), logger).generateQr(input),
    ).rejects.toMatchObject({ code: 'RED_ENLACE_INVALID_RESPONSE' });

    expect(JSON.parse(logger.warn.mock.calls[0][0])).toEqual(
      expect.objectContaining({
        httpStatus: 404,
        message: '<html>Not Found</html>',
        bodyKeys: 'string',
      }),
    );
  });

  it('does not log successful generation', async () => {
    const logger = createLogger();
    const post = jest.fn().mockResolvedValue({ status: 200, data: generateResponse() });

    await createProvider({ post }, {}, createOAuth(), logger).generateQr(input);

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('maps 5xx to RED_ENLACE_UNAVAILABLE', async () => {
    await expect(generate({}, 503)).rejects.toMatchObject({
      code: 'RED_ENLACE_UNAVAILABLE',
    } satisfies Partial<PaymentDomainError>);
  });

  it('rejects a response without data', async () => {
    await expect(generate({ success: true, message: 'ok' })).rejects.toMatchObject({
      code: 'RED_ENLACE_INVALID_RESPONSE',
    } satisfies Partial<PaymentDomainError>);
  });

  it('rejects an origin reference mismatch', async () => {
    await expect(
      generate(generateResponse({ numeroReferenciaOriginante: '999999' })),
    ).rejects.toMatchObject({
      code: 'RED_ENLACE_REFERENCE_MISMATCH',
    } satisfies Partial<PaymentDomainError>);
  });

  it('rejects a missing ATC numeroReferencia', async () => {
    await expect(
      generate(generateResponse({ numeroReferencia: '' })),
    ).rejects.toMatchObject({
      code: 'RED_ENLACE_INVALID_RESPONSE',
    } satisfies Partial<PaymentDomainError>);
  });

  it('rejects an ATC numeroReferencia outside 1 to 9 digits', async () => {
    await expect(
      generate(generateResponse({ numeroReferencia: '1000000000' })),
    ).rejects.toMatchObject({
      code: 'RED_ENLACE_REFERENCE_INVALID',
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

  it.each([undefined, ' ', 'not-base64-qr', 'data:text/plain;base64,UVI='])(
    'rejects PENDIENTE with invalid image %p',
    async (qr) => {
      await expect(generate(generateResponse({ qr }))).rejects.toMatchObject({
        code: 'RED_ENLACE_INVALID_RESPONSE',
      } satisfies Partial<PaymentDomainError>);
    },
  );

  it('rejects a QR image above the configured internal byte limit', async () => {
    const post = jest.fn().mockResolvedValue({ status: 200, data: generateResponse() });
    const provider = createProvider({ post }, { 'app.redEnlace.maxQrImageBytes': 1 });

    await expect(provider.generateQr(input)).rejects.toMatchObject({
      code: 'RED_ENLACE_INVALID_RESPONSE',
    } satisfies Partial<PaymentDomainError>);
  });

  it.each(['20.001', '1e3', ' 20.00', '20,00', '100000000.00'])(
    'rejects provider amount %s without rounding or truncation',
    async (monto) => {
      await expect(generate(generateResponse({ monto }))).rejects.toMatchObject({
        code: 'RED_ENLACE_INVALID_RESPONSE',
      } satisfies Partial<PaymentDomainError>);
    },
  );
});

describe('RedEnlaceQrHttpProvider verify parsing', () => {
  async function verify(body: Record<string, any>, status = 200) {
    const get = jest.fn().mockResolvedValue({ status, data: body });
    return createProvider({ get }).verifyQr({ providerReference: '6780' });
  }

  it.each(['PENDIENTE', 'PAGADO', 'CANCELADO', 'EXPIRADO', 'ERROR'])(
    'uses data.estado %s as provider status',
    async (estado) => {
      await expect(verify(verifyResponse({ estado }))).resolves.toEqual(
        expect.objectContaining({
          providerReference: '6780',
          providerStatus: estado,
          responseCode: estado,
        }),
      );
    },
  );

  it('treats empty bank fields of a pending QR as absent', async () => {
    await expect(verify(verifyResponse())).resolves.toEqual(
      expect.objectContaining({
        providerStatus: 'PENDIENTE',
        responseDetail: 'QR pendiente de pago',
        amountMinor: '2000',
        achReference: null,
        paymentDate: null,
      }),
    );
  });

  it('parses a paid QR without exposing client PII', async () => {
    const result = await verify(
      verifyResponse({
        estado: 'PAGADO',
        mensaje: ' QR pagado ',
        importe: 20.0,
        moneda: 'bob',
        clienteOrigen: {
          nombreCliente: 'NOMBRE',
          numeroCuenta: 'CUENTA',
          ciNitCliente: '14240008',
        },
        bancoOrigen: {
          nombreBanco: 'BANCO',
          fechaTransaccion: '2026-05-26T14:35:20',
          numeroOrdenAch: 'REFERENCIA_ACH',
          codigoBanco: '1016',
        },
      }),
    );

    expect(result).toEqual({
      providerReference: '6780',
      originMerchantReference: '203414',
      amountMinor: '2000',
      currency: 'BOB',
      providerStatus: 'PAGADO',
      responseCode: 'PAGADO',
      responseDetail: 'QR pagado',
      achReference: 'REFERENCIA_ACH',
      paymentDate: new Date('2026-05-26T18:35:20.000Z'),
    });
    expect(JSON.stringify(result)).not.toContain('NOMBRE');
    expect(JSON.stringify(result)).not.toContain('14240008');
    expect(JSON.stringify(result)).not.toContain('CUENTA');
  });

  it.each([
    [
      'TRANSACCION_NO_ENCONTRADA',
      {
        success: false,
        message: 'Error',
        errors: [
          {
            field: 'numeroReferencia',
            message: 'No se encontro la transaccion',
            code: 'TRANSACCION_NO_ENCONTRADA',
          },
        ],
      },
      400,
    ],
    ['HTTP 404', {}, 404],
  ])('maps %s to NOTFOUND', async (_label, body, status) => {
    await expect(verify(body, status)).resolves.toEqual(
      expect.objectContaining({
        providerReference: '6780',
        providerStatus: 'NOTFOUND',
      }),
    );
  });

  it('does not classify other rejections as NOTFOUND', async () => {
    await expect(
      verify({ success: false, message: 'Error', errors: [] }, 400),
    ).rejects.toMatchObject({
      code: 'RED_ENLACE_INVALID_RESPONSE',
    } satisfies Partial<PaymentDomainError>);
  });

  it('does not classify a response without estado as NOTFOUND', async () => {
    await expect(
      verify(verifyResponse({ estado: undefined })),
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

  it.each([
    ['PENDIENTE', 'QR_ACTIVE'],
    ['PAGADO', 'PAYMENT_CONFIRMED'],
    ['EXPIRADO', 'EXPIRED'],
    ['CANCELADO', 'CANCELLED'],
    ['ERROR', 'PROVIDER_ERROR'],
    ['SUCCESS', 'PAYMENT_CONFIRMED'],
  ])('maps provider status %s to %s', (providerStatus, status) => {
    expect(
      mapRedEnlaceStatus({ providerStatus, source: 'RECONCILIATION' }).status,
    ).toBe(status);
  });
});
