import { PadronCertificatePdfService } from '@/modules/institutional-voting/services/core/padron-certificate-pdf.service';

describe('MX-05 | Padrón, staging, elegibilidad y archivos | Backend Results | PadronCertificatePdfService', () => {
  let service: PadronCertificatePdfService;

  beforeEach(() => {
    service = new PadronCertificatePdfService();
  });

  it('PAD-DWN-P1-001 / PAD-CFM-P0-001 | genera un PDF con datos y filas del padrón confirmado', () => {
    const pdf = service.buildPdf({
      eventName: 'Eleccion Directiva 2026',
      eventId: 'evt-001',
      generatedAt: new Date('2026-01-01T12:00:00.000Z'),
      padronVersionId: 'ver-001',
      sourceType: 'PDF_IMPORT',
      totalCount: 2,
      enabledCount: 1,
      disabledCount: 1,
      entries: [
        { ci: '123456', enabled: true },
        { ci: '789000', enabled: false },
      ],
    });

    const text = pdf.toString('latin1');

    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('CONSTANCIA DE PADR\\323N CONFIRMADO');
    expect(text).toContain('Elecci\\363n: Eleccion Directiva 2026');
    expect(text).toContain('ver-001');
    expect(text).toContain('123456 | HABILITADO');
    expect(text).toContain('789000 | INHABILITADO');
  });

  it('PAD-DWN-P1-001 | genera un PDF de listado del padrón separado de la constancia', () => {
    const pdf = service.buildPadronListPdf({
      eventName: 'Consulta 2026',
      generatedAt: new Date('2026-01-01T12:00:00.000Z'),
      padronVersionId: 'ver-002',
      statusLabel: 'Padrón vigente',
      totalCount: 2,
      enabledCount: 1,
      disabledCount: 1,
      entries: [
        { ci: '123456', enabled: true },
        { ci: '789000', enabled: false },
      ],
    });

    const text = pdf.toString('latin1');

    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('PADR\\323N DE VOTACI\\323N');
    expect(text).not.toContain('CONSTANCIA DE PADR\\323N CONFIRMADO');
    expect(text).toContain('Consulta 2026');
    expect(text).toContain('Padr\\363n vigente');
    expect(text).toContain('123456 | HABILITADO');
    expect(text).toContain('789000 | INHABILITADO');
  });

  it('PAD-DWN-P1-001 | declara WinAnsi y codifica acentos interpretables por Helvetica', () => {
    const pdf = service.buildPadronListPdf({
      eventName: 'Elección áéíóúñ ÁÉÍÓÚÑ',
      generatedAt: new Date('2026-01-01T12:00:00.000Z'),
      padronVersionId: 'ver-acentos',
      statusLabel: 'Padrón vigente',
      totalCount: 2,
      enabledCount: 1,
      disabledCount: 1,
      entries: [
        { ci: '123456', enabled: true },
        { ci: '789000', enabled: false },
      ],
    });

    const text = pdf.toString('latin1');

    expect(text).toContain('/BaseFont /Helvetica /Encoding /WinAnsiEncoding');
    expect(text).toContain('Padr\\363n vigente');
    expect(text).toContain('Elecci\\363n \\341\\351\\355\\363\\372\\361 \\301\\311\\315\\323\\332\\321');
    expect(text).toContain('Generado:');
    expect(text).toContain('Versi\\363n padr\\363n:');
    expect(text).toContain('HABILITADO');
    expect(text).toContain('INHABILITADO');

    const historicPdf = service.buildPadronListPdf({
      eventName: 'Elección histórica',
      generatedAt: new Date('2025-01-01T12:00:00.000Z'),
      padronVersionId: 'ver-historica',
      statusLabel: 'Versión histórica',
      totalCount: 1,
      enabledCount: 1,
      disabledCount: 0,
      entries: [{ ci: '123456', enabled: true }],
    });

    expect(historicPdf.toString('latin1')).toContain('Estado: Versi\\363n hist\\363rica');
  });
});
