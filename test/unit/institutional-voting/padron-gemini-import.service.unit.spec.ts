import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { PadronGeminiImportService } from '@/modules/institutional-voting/services/core/padron-gemini-import.service';

describe('MX-05 | Padrón, staging, elegibilidad y archivos | Backend Results | PadronGeminiImportService', () => {
  let configService: any;
  let httpService: any;
  let service: PadronGeminiImportService;

  const validPdfFile = {
    buffer: Buffer.from('%PDF-1.4\nmock\n', 'utf-8'),
    originalname: 'padron.pdf',
    mimetype: 'application/pdf',
    size: 16,
  };

  beforeEach(() => {
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'app.ai.gemini.apiKey') return 'backend-secret-key';
        if (key === 'app.ai.gemini.model') return 'gemini-test';
        return undefined;
      }),
    };
    httpService = {
      axiosRef: {
        post: jest.fn().mockResolvedValue({
          data: {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        records: [
                          { carnet: '123.456', habilitado: true },
                          { carnet: '876543', habilitado: false },
                        ],
                        observations: [
                          {
                            message: 'Encabezado omitido',
                            rowIndex: null,
                            rawValue: null,
                          },
                        ],
                      }),
                    },
                  ],
                },
              },
            ],
          },
        }),
      },
    };
    service = new PadronGeminiImportService(configService, httpService);
  });

  it('PAD-EXT-P1-001 | llama a Gemini simulado con la key del backend y devuelve el contrato del frontend', async () => {
    const result = await service.analyzeDocument(validPdfFile);

    expect(httpService.axiosRef.post).toHaveBeenCalledTimes(1);
    const [url, body, options] = httpService.axiosRef.post.mock.calls[0];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent',
    );
    expect(url).not.toContain('backend-secret-key');
    expect(options.headers['x-goog-api-key']).toBe('backend-secret-key');
    expect(body.contents[0].parts[1].inline_data.mime_type).toBe('application/pdf');

    expect(result).toMatchObject({
      fileName: 'padron.pdf',
      sourceType: 'PDF_GEMINI',
      analysisProvider: 'GEMINI_CLIENT',
      model: 'gemini-test',
      records: [
        expect.objectContaining({
          carnet: '123456',
          enabled: true,
          sourceKind: 'PARSED',
        }),
        expect.objectContaining({
          carnet: '876543',
          enabled: false,
          sourceKind: 'PARSED',
        }),
      ],
      observations: [
        expect.objectContaining({
          code: 'GEMINI_OBSERVATION',
          message: 'Encabezado omitido',
        }),
      ],
    });
  });

  it('PAD-EXT-P1-001 / PAD-PRC-P0-003 | rechaza una respuesta inválida con error controlado', async () => {
    httpService.axiosRef.post.mockResolvedValueOnce({
      data: {
        candidates: [
          {
            content: {
              parts: [{ text: 'sin-json' }],
            },
          },
        ],
      },
    });

    await expect(service.analyzeDocument(validPdfFile)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('PAD-EXT-P1-001 / PAD-PRC-P0-003 | convierte timeout de Gemini en error controlado sin exponer red real', async () => {
    const timeout = new Error('timeout of 60000ms exceeded') as Error & {
      code?: string;
    };
    timeout.code = 'ECONNABORTED';
    httpService.axiosRef.post.mockRejectedValueOnce(timeout);

    await expect(service.analyzeDocument(validPdfFile)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(httpService.axiosRef.post).toHaveBeenCalledTimes(1);
  });

  it('PAD-EXT-P1-001 | no procesa si falta la key del backend', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'app.ai.gemini.apiKey') return '';
      if (key === 'app.ai.gemini.model') return 'gemini-test';
      return undefined;
    });

    await expect(service.analyzeDocument(validPdfFile)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(httpService.axiosRef.post).not.toHaveBeenCalled();
  });

  it('PAD-EXT-P1-001 / PAD-FIL-P0-001 | rechaza archivos mayores a 20 MB antes de llamar Gemini', async () => {
    const oversizedFile = {
      ...validPdfFile,
      size: 20 * 1024 * 1024 + 1,
      buffer: Buffer.alloc(20 * 1024 * 1024 + 1),
    };

    await expect(service.analyzeDocument(oversizedFile)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(httpService.axiosRef.post).not.toHaveBeenCalled();
  });
});
