import { Injectable } from '@nestjs/common';

type PadronCertificatePdfEntry = {
  ci: string;
  enabled: boolean;
};

type BuildPadronCertificatePdfParams = {
  eventName: string;
  eventId: string;
  generatedAt: Date;
  padronVersionId: string;
  sourceType: 'CSV_LEGACY' | 'PDF_IMPORT' | 'IMAGE_IMPORT';
  totalCount: number;
  enabledCount: number;
  disabledCount: number;
  entries: PadronCertificatePdfEntry[];
};

type BuildPadronListPdfParams = {
  eventName: string;
  generatedAt: Date;
  padronVersionId: string;
  statusLabel: string;
  totalCount: number;
  enabledCount: number;
  disabledCount: number;
  entries: PadronCertificatePdfEntry[];
};

@Injectable()
export class PadronCertificatePdfService {
  buildPdf(params: BuildPadronCertificatePdfParams): Buffer {
    return this.buildSimplePdf([
      'CONSTANCIA DE PADRON CONFIRMADO',
      '',
      `Eleccion: ${params.eventName}`,
      `Evento: ${params.eventId}`,
      `Generado: ${params.generatedAt.toISOString()}`,
      `Version padron: ${params.padronVersionId}`,
      `Origen: ${params.sourceType}`,
      `Total registros: ${params.totalCount}`,
      `Total habilitados: ${params.enabledCount}`,
      `Total inhabilitados: ${params.disabledCount}`,
      '',
      'CI | ESTADO',
      ...params.entries.map((entry) => `${entry.ci} | ${entry.enabled ? 'HABILITADO' : 'INHABILITADO'}`),
    ]);
  }

  buildPadronListPdf(params: BuildPadronListPdfParams): Buffer {
    const lines = [
      'PADRON DE VOTACION',
      '',
      `Eleccion: ${params.eventName}`,
      `Generado: ${params.generatedAt.toISOString()}`,
      `Version padron: ${params.padronVersionId}`,
      `Estado: ${params.statusLabel}`,
      `Total registros: ${params.totalCount}`,
      `Total habilitados: ${params.enabledCount}`,
      `Total inhabilitados: ${params.disabledCount}`,
      '',
      'CI | ESTADO',
      ...params.entries.map((entry) => `${entry.ci} | ${entry.enabled ? 'HABILITADO' : 'INHABILITADO'}`),
    ];

    return this.buildSimplePdf(lines);
  }

  private buildSimplePdf(lines: string[]): Buffer {
    const pages = this.paginate(lines, 48);
    const objects: string[] = [];

    objects.push('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj');

    const pageObjectIds = pages.map((_, index) => 4 + index * 2);
    objects.push(
      `2 0 obj << /Type /Pages /Count ${pages.length} /Kids [${pageObjectIds
        .map((id) => `${id} 0 R`)
        .join(' ')}] >> endobj`,
    );
    objects.push('3 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj');

    pages.forEach((pageLines, index) => {
      const pageObjectId = 4 + index * 2;
      const contentObjectId = 5 + index * 2;
      const content = this.buildPageContent(pageLines);
      const contentLength = Buffer.byteLength(content, 'utf-8');

      objects.push(
        `${pageObjectId} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectId} 0 R >> endobj`,
      );
      objects.push(
        `${contentObjectId} 0 obj << /Length ${contentLength} >> stream\n${content}\nendstream endobj`,
      );
    });

    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [0];

    objects.forEach((object) => {
      offsets.push(Buffer.byteLength(pdf, 'utf-8'));
      pdf += `${object}\n`;
    });

    const xrefOffset = Buffer.byteLength(pdf, 'utf-8');
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += '0000000000 65535 f \n';
    for (let index = 1; index < offsets.length; index += 1) {
      pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\n`;
    pdf += `startxref\n${xrefOffset}\n%%EOF`;

    return Buffer.from(pdf, 'utf-8');
  }

  private paginate(lines: string[], maxLinesPerPage: number) {
    const pages: string[][] = [];
    for (let index = 0; index < lines.length; index += maxLinesPerPage) {
      pages.push(lines.slice(index, index + maxLinesPerPage));
    }
    return pages.length > 0 ? pages : [[]];
  }

  private buildPageContent(lines: string[]) {
    const escaped = lines.map((line) => this.escapePdfText(line));
    const lineHeight = 14;
    const startY = 800;

    let content = 'BT\n/F1 10 Tf\n';
    escaped.forEach((line, index) => {
      const y = startY - index * lineHeight;
      content += `1 0 0 1 40 ${y} Tm (${line}) Tj\n`;
    });
    content += 'ET';

    return content;
  }

  private escapePdfText(value: string) {
    return String(value)
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
  }
}
