import { BadRequestException } from '@nestjs/common';
import { PadronGeminiImportService } from '@/modules/institutional-voting/services/core/padron-gemini-import.service';
import { PadronPdfParserService } from '@/modules/institutional-voting/services/core/padron-pdf-parser.service';
import { normalizeCarnet } from '@/modules/institutional-voting/utils/carnet-normalizer';

describe('MX-05 Backend Results — unitarias focales de padrón', () => {
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'app.ai.gemini.apiKey') return 'gemini-only-test-key';
      if (key === 'app.ai.gemini.model') return 'gemini-test';
      return undefined;
    }),
  };
  const http = { axiosRef: { post: jest.fn() } };
  const parser = () => new PadronPdfParserService(config as never, http as never);
  const gemini = () => new PadronGeminiImportService(config as never, http as never);
  const pdf = (text: string) => ({
    originalname: 'padron.pdf',
    mimetype: 'application/pdf',
    buffer: Buffer.from(`%PDF-1.4\n${text}\n`, 'utf8'),
  });

  beforeEach(() => jest.clearAllMocks());

  it('[MX-05][PAD-FIL-P0-001][UNITARIA] rechaza ausencia, extensión no permitida y firmas incompatibles antes de analizar', () => {
    const service = parser();
    expect(() => service.validateSourceFile({ originalname: 'padron.pdf', mimetype: 'application/pdf', buffer: Buffer.alloc(0) })).toThrow(BadRequestException);
    expect(() => service.validateSourceFile({ originalname: 'padron.txt', mimetype: 'text/plain', buffer: Buffer.from('123456 si') })).toThrow(BadRequestException);
    expect(() => service.validateSourceFile({ originalname: 'padron.png', mimetype: 'image/png', buffer: Buffer.from('not-a-png') })).toThrow(BadRequestException);
    expect(http.axiosRef.post).not.toHaveBeenCalled();
  });

  it('[MX-05][PAD-EXT-P1-001][UNITARIA] mantiene la key en backend y normaliza la respuesta Gemini simulada', async () => {
    http.axiosRef.post.mockResolvedValue({ data: { candidates: [{ content: { parts: [{ text: JSON.stringify({ records: [{ carnet: '123.456', habilitado: true }], observations: [] }) }] } }] } });
    const result = await gemini().analyzeDocument({ ...pdf('123456 si'), size: 20 });
    expect(http.axiosRef.post).toHaveBeenCalledWith(expect.not.stringContaining('gemini-only-test-key'), expect.any(Object), expect.objectContaining({ headers: expect.objectContaining({ 'x-goog-api-key': 'gemini-only-test-key' }) }));
    expect(result.records).toEqual([expect.objectContaining({ carnet: '123456', enabled: true })]);
  });

  it('[MX-05][PAD-PRC-P0-002][UNITARIA] produce filas procesables y resumen determinístico sin usar Gemini para PDF claro', async () => {
    const result = await parser().parseDocument(pdf('carnet habilitado\n123456 si\n789000 no'));
    expect(result.rows).toEqual([{ ci: '123456', enabled: true, sourceRow: 2 }, { ci: '789000', enabled: false, sourceRow: 3 }]);
    expect(result.errors).toEqual([]);
    expect(result.provider).toBe('deterministic-text');
    expect(http.axiosRef.post).not.toHaveBeenCalled();
  });

  it('[MX-05][PAD-ROW-P0-002][UNITARIA] conserva explícitamente la habilitación extraída por cada identidad', async () => {
    const result = await parser().parseDocument(pdf('123456 si\n789000 no'));
    expect(result.rows.map((row) => [row.ci, row.enabled])).toEqual([['123456', true], ['789000', false]]);
  });

  it('[MX-05][PAD-NRM-P0-001][UNITARIA] normaliza antes de persistir y rechaza carnet inválido', () => {
    expect(normalizeCarnet(' 123.456 ')).toBe('123456');
    expect(normalizeCarnet(' ab - 123 ')).toBe('AB123');
    expect(normalizeCarnet('ABCDEF')).toBe('');
    expect(normalizeCarnet('@@@')).toBe('');
    expect(normalizeCarnet('AB12')).toBe('');
    expect(normalizeCarnet(`A${'1'.repeat(20)}`)).toBe('');
  });

  it('[MX-05][PAD-VAL-P0-001][UNITARIA] conserva fila, código y valor crudo de observaciones de extracción', async () => {
    http.axiosRef.post.mockResolvedValue({ data: { candidates: [{ content: { parts: [{ text: JSON.stringify({ rows: [{ ci: '123456', enabled: true, sourceRow: 7 }], errors: [{ code: 'INVALID_CI', message: 'CI ilegible', rowIndex: 8, rawValue: '---' }] }) }] } }] } });
    const result = await parser().parseDocument(pdf('obj\nendobj\nstream\nendstream'));
    expect(result.rows).toEqual([expect.objectContaining({ ci: '123456', sourceRow: 7 })]);
    expect(result.errors).toEqual([expect.objectContaining({ code: 'INVALID_CI', rowIndex: 8, rawValue: '---' })]);
  });

  it('[MX-05][PAD-DUP-P0-001][UNITARIA] elimina el segundo carnet normalizado y lo informa como observación', async () => {
    http.axiosRef.post.mockResolvedValue({ data: { candidates: [{ content: { parts: [{ text: JSON.stringify({ records: [{ carnet: '123.456', habilitado: true }, { carnet: '123456', habilitado: false }], observations: [] }) }] } }] } });
    const result = await gemini().analyzeDocument({ ...pdf('ambiguous'), size: 20 });
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({ carnet: '123456', enabled: true });
    expect(result.observations).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'DUPLICATE_CARNET' })]));
  });

});
