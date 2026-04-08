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
});
