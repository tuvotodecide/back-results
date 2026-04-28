import { PadronCertificatePdfService } from '@/modules/institutional-voting/services/core/padron-certificate-pdf.service';

describe('PadronCertificatePdfService (unit)', () => {
  let service: PadronCertificatePdfService;

  beforeEach(() => {
    service = new PadronCertificatePdfService();
  });

  it('genera un PDF con datos y filas del padrón confirmado', () => {
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

    const text = pdf.toString('utf-8');

    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('CONSTANCIA DE PADRON CONFIRMADO');
    expect(text).toContain('Eleccion Directiva 2026');
    expect(text).toContain('ver-001');
    expect(text).toContain('123456 | HABILITADO');
    expect(text).toContain('789000 | INHABILITADO');
  });

  it('genera un PDF de listado del padrón separado de la constancia', () => {
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

    const text = pdf.toString('utf-8');

    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('PADRON DE VOTACION');
    expect(text).not.toContain('CONSTANCIA DE PADRON CONFIRMADO');
    expect(text).toContain('Consulta 2026');
    expect(text).toContain('Padrón vigente');
    expect(text).toContain('123456 | HABILITADO');
    expect(text).toContain('789000 | INHABILITADO');
  });
});
