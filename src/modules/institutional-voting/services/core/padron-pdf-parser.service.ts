import { HttpService } from '@nestjs/axios';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { normalizeCarnet } from '../../utils/carnet-normalizer';

export type SupportedPadronSourceType = 'PDF' | 'IMAGE';

export type ParsedPadronRow = {
  ci: string;
  enabled: boolean;
  sourceRow?: number | null;
};

export type PadronParserError = {
  code: string;
  message: string;
  rowIndex?: number | null;
  rawValue?: string | null;
};

export type PadronPdfParserResult = {
  rows: ParsedPadronRow[];
  errors: PadronParserError[];
  provider: string;
  model: string | null;
  usedFallback: boolean;
};

type DeterministicSignal = {
  confidence: number;
  shouldEscalate: boolean;
  headerDetected: boolean;
  candidateLines: number;
  extractedLines: number;
  rowsWithExplicitEnabled: number;
  readableRatio: number;
};

type DeterministicPadronPdfParserResult = PadronPdfParserResult & {
  signal: DeterministicSignal;
};

type PadronSourceFile = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
};

@Injectable()
export class PadronPdfParserService {
  private readonly geminiApiKey: string;
  private readonly geminiModel: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    this.geminiApiKey = this.configService.get<string>('app.ai.gemini.apiKey') ?? '';
    this.geminiModel =
      this.configService.get<string>('app.ai.gemini.model') ?? 'gemini-2.5-flash';
  }

  validateSourceFile(file: { buffer?: Buffer; mimetype?: string; originalname?: string }) {
    const buffer = file?.buffer;
    if (!buffer || !buffer.length) {
      throw new BadRequestException('Archivo de padrón requerido');
    }

    const mimeType = String(file?.mimetype ?? '').toLowerCase();
    const fileName = String(file?.originalname ?? '').toLowerCase();
    const isPdfMime = mimeType === 'application/pdf';
    const hasPdfExtension = fileName.endsWith('.pdf');
    const isImageMime = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(mimeType);
    const hasImageExtension = ['.jpg', '.jpeg', '.png', '.webp'].some((ext) =>
      fileName.endsWith(ext),
    );
    const hasPdfHeader = buffer.subarray(0, 4).toString('utf-8') === '%PDF';
    const hasPngHeader =
      buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const hasJpegHeader =
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff;
    const hasWebpHeader =
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP';

    if (isPdfMime || hasPdfExtension) {
      if (!hasPdfHeader) {
        throw new BadRequestException('Archivo PDF inválido');
      }
      return;
    }

    if (isImageMime || hasImageExtension) {
      if (!hasPngHeader && !hasJpegHeader && !hasWebpHeader) {
        throw new BadRequestException('Archivo de imagen inválido');
      }
      return;
    }

    throw new BadRequestException(
      'Solo se admiten archivos PDF, JPG, JPEG, PNG o WEBP para el padrón',
    );
  }

  validatePdfFile(file: { buffer?: Buffer; mimetype?: string; originalname?: string }) {
    return this.validateSourceFile(file);
  }

  async parsePdf(
    file: PadronSourceFile,
  ): Promise<PadronPdfParserResult> {
    return this.parseDocument(file);
  }

  async parseDocument(file: PadronSourceFile): Promise<PadronPdfParserResult> {
    this.validateSourceFile(file);

    const deterministicResult = this.parseDeterministically(file.buffer);

    if (!deterministicResult.signal.shouldEscalate) {
      return this.stripDeterministicSignal(deterministicResult);
    }

    if (this.geminiApiKey) {
      try {
        return await this.parseWithGemini(file.buffer, file.mimetype);
      } catch {
        return {
          ...this.stripDeterministicSignal(deterministicResult),
          usedFallback: true,
        };
      }
    }

    return this.stripDeterministicSignal(deterministicResult);
  }

  getSourceType(file: { mimetype?: string; originalname?: string }): SupportedPadronSourceType {
    const mimeType = String(file?.mimetype ?? '').toLowerCase();
    const fileName = String(file?.originalname ?? '').toLowerCase();
    if (
      mimeType === 'application/pdf' ||
      fileName.endsWith('.pdf')
    ) {
      return 'PDF';
    }
    return 'IMAGE';
  }

  private async parseWithGemini(
    buffer: Buffer,
    mimeType: string,
  ): Promise<PadronPdfParserResult> {
    const prompt = [
      'Extrae un padrón tabular desde este documento o imagen.',
      'Devuelve SOLO JSON válido con la forma {"rows":[{"ci":"...","enabled":true}],"errors":[{"code":"...","message":"...","rowIndex":1,"rawValue":"..."}]}.',
      'Cada fila debe contener únicamente "ci" y "enabled".',
      'Reconoce columnas equivalentes a carnet, ci, dni, habilitado o estado.',
      'Si el valor de habilitación no existe, asume enabled=true.',
      'Usa Gemini solo para resolver PDFs escaneados, imágenes de tabla, contenido ambiguo o mal tabulado.',
      'No devuelvas markdown ni texto adicional.',
    ].join(' ');

    const response = await this.httpService.axiosRef.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.geminiModel}:generateContent?key=${this.geminiApiKey}`,
      {
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: buffer.toString('base64'),
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
        },
      },
    );

    const rawText =
      response?.data?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text ?? '').join('') ??
      '';

    const parsed = JSON.parse(this.extractJsonPayload(rawText));
    const rows = Array.isArray(parsed?.rows)
      ? parsed.rows.map((row: any, index: number) => ({
          ci: String(row?.ci ?? '').trim(),
          enabled: row?.enabled !== false,
          sourceRow: typeof row?.sourceRow === 'number' ? row.sourceRow : index + 1,
        }))
      : [];

    const errors = Array.isArray(parsed?.errors)
      ? parsed.errors.map((error: any) => ({
          code: String(error?.code ?? 'PARSER_WARNING'),
          message: String(error?.message ?? 'Advertencia de parseo'),
          rowIndex:
            typeof error?.rowIndex === 'number' ? error.rowIndex : null,
          rawValue: error?.rawValue ? String(error.rawValue) : null,
        }))
      : [];

    return {
      rows,
      errors,
      provider: 'gemini',
      model: this.geminiModel,
      usedFallback: false,
    };
  }

  private parseDeterministically(buffer: Buffer): DeterministicPadronPdfParserResult {
    const text = buffer
      .toString('latin1')
      .replace(/\0/g, ' ')
      .replace(/[^\x09\x0A\x0D\x20-\x7E\u00C0-\u017F]/g, ' ');

    const rawLines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    // sourceRow se calcula sobre líneas lógicas del documento ya limpiadas:
    // excluye headers de transporte/formato (%PDF, PNG, JFIF, etc.) y ruido binario.
    const lines = rawLines.filter((line) => !this.isIgnorableTransportLine(line));

    const rows: ParsedPadronRow[] = [];
    const errors: PadronParserError[] = [];
    let rowsWithExplicitEnabled = 0;

    const headerDetected = lines.some((line) => {
      const lowered = line.toLowerCase();
      return (
        (lowered.includes('carnet') || lowered.includes('ci') || lowered.includes('dni')) &&
        lowered.includes('habil')
      );
    });

    const candidateLines = lines.filter((line) =>
      line
        .replace(/[|;,]/g, ' ')
        .split(/\s+/)
        .some((chunk) => Boolean(normalizeCarnet(chunk))),
    ).length;

    lines.forEach((line, index) => {
      const chunks = line
        .replace(/[|;,]/g, ' ')
        .split(/\s+/)
        .map((chunk) => chunk.trim())
        .filter(Boolean);

      const ciToken = chunks.find((chunk) => Boolean(normalizeCarnet(chunk)));
      if (!ciToken) {
        return;
      }

      const enabledToken = chunks.find((chunk) =>
        [
          'si',
          'sí',
          'no',
          'true',
          'false',
          '1',
          '0',
          'habilitado',
          'inhabilitado',
          'deshabilitado',
          'activo',
          'inactivo',
        ].includes(chunk.toLowerCase()),
      );

      const enabled = this.parseEnabledToken(enabledToken);
      if (enabled === null) {
        errors.push({
          code: 'INVALID_ENABLED_VALUE',
          message: 'No se pudo interpretar la columna de habilitación',
          rowIndex: index + 1,
          rawValue: line,
        });
        return;
      }

      if (enabledToken) {
        rowsWithExplicitEnabled++;
      }

      rows.push({
        ci: ciToken,
        enabled,
        sourceRow: index + 1,
      });
    });

    if (!rows.length) {
      errors.push({
        code: 'EMPTY_RESULT',
        message: 'No se encontraron filas tabulares válidas en el PDF',
      });
    }

    const readableChars = text.replace(/\s/g, '').length;
    const binaryPenaltyChars = (buffer.toString('latin1').match(/[^\x09\x0A\x0D\x20-\x7E\u00C0-\u017F]/g) ?? [])
      .length;
    const readableRatio =
      readableChars + binaryPenaltyChars > 0
        ? readableChars / (readableChars + binaryPenaltyChars)
        : 0;

    const confidence = this.calculateDeterministicConfidence({
      rowsCount: rows.length,
      errorsCount: errors.length,
      headerDetected,
      candidateLines,
      rowsWithExplicitEnabled,
      readableRatio,
    });

    return {
      rows,
      errors,
      provider: 'deterministic-text',
      model: null,
      usedFallback: false,
      signal: {
        confidence,
        shouldEscalate: this.shouldEscalateToGemini({
          rowsCount: rows.length,
          errorsCount: errors.length,
          headerDetected,
          candidateLines,
          rowsWithExplicitEnabled,
          readableRatio,
          confidence,
        }),
        headerDetected,
        candidateLines,
        extractedLines: lines.length,
        rowsWithExplicitEnabled,
        readableRatio,
      },
    };
  }

  private parseEnabledToken(value?: string): boolean | null {
    if (!value) return true;

    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'si', 'sí', 'habilitado', 'activo'].includes(normalized)) {
      return true;
    }
    if (['0', 'false', 'no', 'inhabilitado', 'deshabilitado', 'inactivo'].includes(normalized)) {
      return false;
    }
    return null;
  }

  private extractJsonPayload(rawText: string) {
    const trimmed = String(rawText ?? '').trim();
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new BadRequestException('La respuesta del parser Gemini no contiene JSON válido');
    }
    return jsonMatch[0];
  }

  private isIgnorableTransportLine(line: string): boolean {
    const lowered = line.toLowerCase().trim();
    if (!lowered) return true;

    if (
      lowered.startsWith('%pdf') ||
      ['obj', 'endobj', 'stream', 'endstream', 'xref', 'trailer', 'startxref'].includes(lowered)
    ) {
      return true;
    }

    if (['png', 'jfif', 'exif', 'webp', 'riff'].includes(lowered)) {
      return true;
    }

    const hasCiToken = lowered
      .replace(/[|;,]/g, ' ')
      .split(/\s+/)
      .some((chunk) => Boolean(normalizeCarnet(chunk)));
    const hasEnabledHint = /habil|si|sí|no|true|false|activo|inactivo/.test(lowered);
    const hasTableHint = /carnet|ci|dni/.test(lowered);
    const hasWhitespaceOrDelimiter = /[\s|;,]/.test(line);

    if (!hasCiToken && !hasEnabledHint && !hasTableHint && !hasWhitespaceOrDelimiter) {
      return true;
    }

    return false;
  }

  private calculateDeterministicConfidence(params: {
    rowsCount: number;
    errorsCount: number;
    headerDetected: boolean;
    candidateLines: number;
    rowsWithExplicitEnabled: number;
    readableRatio: number;
  }) {
    const {
      rowsCount,
      errorsCount,
      headerDetected,
      candidateLines,
      rowsWithExplicitEnabled,
      readableRatio,
    } = params;

    if (rowsCount <= 0) return 0;

    let confidence = 0.2;

    confidence += Math.min(0.25, rowsCount * 0.08);
    confidence += headerDetected ? 0.2 : 0;
    confidence += candidateLines > 0 ? Math.min(0.15, rowsCount / candidateLines * 0.15) : 0;
    confidence += rowsCount > 0 ? Math.min(0.15, rowsWithExplicitEnabled / rowsCount * 0.15) : 0;
    confidence += Math.max(0, Math.min(0.15, (1 - errorsCount / Math.max(rowsCount, 1)) * 0.15));
    confidence += Math.max(0, Math.min(0.1, readableRatio * 0.1));

    return Math.max(0, Math.min(1, confidence));
  }

  private shouldEscalateToGemini(params: {
    rowsCount: number;
    errorsCount: number;
    headerDetected: boolean;
    candidateLines: number;
    rowsWithExplicitEnabled: number;
    readableRatio: number;
    confidence: number;
  }) {
    const {
      rowsCount,
      errorsCount,
      headerDetected,
      candidateLines,
      rowsWithExplicitEnabled,
      readableRatio,
      confidence,
    } = params;

    if (rowsCount <= 0) return true;
    if (readableRatio < 0.2) return true;
    if (candidateLines > 0 && rowsCount / candidateLines < 0.5) return true;
    if (errorsCount > rowsCount) return true;
    if (!headerDetected && rowsCount < 3 && rowsWithExplicitEnabled === 0) return true;
    return confidence < 0.65;
  }

  private stripDeterministicSignal(
    result: DeterministicPadronPdfParserResult,
  ): PadronPdfParserResult {
    return {
      rows: result.rows,
      errors: result.errors,
      provider: result.provider,
      model: result.model,
      usedFallback: result.usedFallback,
    };
  }
}
