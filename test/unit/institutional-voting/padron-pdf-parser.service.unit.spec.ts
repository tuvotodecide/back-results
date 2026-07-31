import { Test } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { PadronPdfParserService } from '@/modules/institutional-voting/services/core/padron-pdf-parser.service';

describe('MX-05 | Padrón, staging, elegibilidad y archivos | Backend Results | PadronPdfParserService', () => {
  let service: PadronPdfParserService;
  let configService: { get: jest.Mock };
  let httpService: { axiosRef: { post: jest.Mock } };

  beforeEach(async () => {
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'app.ai.gemini.apiKey') return 'test-gemini-key';
        if (key === 'app.ai.gemini.model') return 'gemini-2.5-flash';
        return undefined;
      }),
    };

    httpService = {
      axiosRef: {
        post: jest.fn(),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PadronPdfParserService,
        { provide: ConfigService, useValue: configService },
        { provide: HttpService, useValue: httpService },
      ],
    }).compile();

    service = moduleRef.get(PadronPdfParserService);
  });

  function buildPdf(lines: string[]) {
    return {
      originalname: 'padron.pdf',
      mimetype: 'application/pdf',
      buffer: Buffer.from(`%PDF-1.4\n${lines.join('\n')}\n`, 'utf-8'),
    };
  }

  function buildPngWithText(lines: string[]) {
    return {
      originalname: 'padron.png',
      mimetype: 'image/png',
      buffer: Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from(`\n${lines.join('\n')}\n`, 'utf-8'),
      ]),
    };
  }

  function buildPngBinaryOnly() {
    return {
      originalname: 'padron.png',
      mimetype: 'image/png',
      buffer: Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from([0x00, 0xff, 0x10, 0x89, 0xab, 0xcd]),
      ]),
    };
  }

  it('PAD-VAL-P0-001 / PAD-NRM-P0-001 | resuelve PDFs claros con parser determinístico sin invocar Gemini', async () => {
    const result = await service.parsePdf(
      buildPdf(['carnet habilitado', '123456 si', '789000 no', 'ABC789 si']),
    );

    expect(httpService.axiosRef.post).not.toHaveBeenCalled();
    expect(result.provider).toBe('deterministic-text');
    expect(result.model).toBeNull();
    expect(result.usedFallback).toBe(false);
    expect(result.rows).toEqual([
      { ci: '123456', enabled: true, sourceRow: 2 },
      { ci: '789000', enabled: false, sourceRow: 3 },
      { ci: 'ABC789', enabled: true, sourceRow: 4 },
    ]);
  });

  it('PAD-EXT-P1-001 / PAD-VAL-P0-001 | escala a Gemini cuando el PDF es ambiguo o el parseo determinístico no alcanza', async () => {
    httpService.axiosRef.post.mockResolvedValue({
      data: {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    rows: [{ ci: '123456', enabled: true, sourceRow: 1 }],
                    errors: [],
                  }),
                },
              ],
            },
          },
        ],
      },
    });

    const result = await service.parsePdf(buildPdf(['obj', 'endobj', 'stream', 'endstream']));

    expect(httpService.axiosRef.post).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe('gemini');
    expect(result.model).toBe('gemini-2.5-flash');
    expect(result.usedFallback).toBe(false);
    expect(result.rows).toEqual([{ ci: '123456', enabled: true, sourceRow: 1 }]);
  });

  it('PAD-VAL-P0-001 | resuelve una imagen clara con parser determinístico sin invocar Gemini', async () => {
    const result = await service.parseDocument(
      buildPngWithText(['carnet habilitado', '123456 si', '789000 no']),
    );

    expect(httpService.axiosRef.post).not.toHaveBeenCalled();
    expect(result.provider).toBe('deterministic-text');
    expect(result.usedFallback).toBe(false);
    expect(result.rows).toEqual([
      { ci: '123456', enabled: true, sourceRow: 2 },
      { ci: '789000', enabled: false, sourceRow: 3 },
    ]);
  });

  it('PAD-EXT-P1-001 / PAD-VAL-P0-001 | escala a Gemini cuando la imagen es ambigua o ilegible para el parser simple', async () => {
    httpService.axiosRef.post.mockResolvedValue({
      data: {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    rows: [{ ci: '123456', enabled: true, sourceRow: 1 }],
                    errors: [],
                  }),
                },
              ],
            },
          },
        ],
      },
    });

    const result = await service.parseDocument(buildPngBinaryOnly());

    expect(httpService.axiosRef.post).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe('gemini');
    expect(result.model).toBe('gemini-2.5-flash');
    expect(result.rows).toEqual([{ ci: '123456', enabled: true, sourceRow: 1 }]);
  });

  it('PAD-EXT-P1-001 / PAD-PRC-P0-003 | vuelve al resultado determinístico si Gemini falla en un PDF difícil', async () => {
    httpService.axiosRef.post.mockRejectedValue(new Error('Gemini down'));

    const result = await service.parsePdf(buildPdf(['obj', 'endobj', 'stream', 'endstream']));

    expect(httpService.axiosRef.post).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe('deterministic-text');
    expect(result.usedFallback).toBe(true);
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'EMPTY_RESULT',
        }),
      ]),
    );
  });

  it('PAD-VAL-P0-001 / PAD-PRC-P0-003 | reporta imagen ilegible si no puede resolverla ni determinísticamente ni con Gemini', async () => {
    httpService.axiosRef.post.mockRejectedValue(new Error('Gemini down'));

    const result = await service.parseDocument(buildPngBinaryOnly());

    expect(httpService.axiosRef.post).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe('deterministic-text');
    expect(result.usedFallback).toBe(true);
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'EMPTY_RESULT',
        }),
      ]),
    );
  });

  it('PAD-FIL-P0-001 | rechaza archivo ausente, extensión o firma inconsistente antes de procesar', () => {
    const invalidFiles = [
      {
        originalname: 'padron.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.alloc(0),
      },
      {
        originalname: 'padron.txt',
        mimetype: 'text/plain',
        buffer: Buffer.from('123456 si', 'utf-8'),
      },
      {
        originalname: 'padron.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.from('no-pdf', 'utf-8'),
      },
      {
        originalname: 'padron.png',
        mimetype: 'image/png',
        buffer: Buffer.from('not-png', 'utf-8'),
      },
      {
        originalname: 'padron.jpg',
        mimetype: 'image/jpeg',
        buffer: Buffer.from('not-jpg', 'utf-8'),
      },
      {
        originalname: 'padron.webp',
        mimetype: 'image/webp',
        buffer: Buffer.from('not-webp', 'utf-8'),
      },
    ];

    invalidFiles.forEach((file) => {
      expect(() => service.validateSourceFile(file)).toThrow(BadRequestException);
    });
    expect(httpService.axiosRef.post).not.toHaveBeenCalled();
  });
});
