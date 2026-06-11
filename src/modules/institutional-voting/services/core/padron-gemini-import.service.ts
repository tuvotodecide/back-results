import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { randomUUID } from 'crypto';
import { normalizeCarnet } from '../../utils/carnet-normalizer';
import type { PadronImportError } from '../../schemas/padron-import-job.schema';

export type GeminiPadronDraftRecord = {
  id: string;
  carnet: string;
  enabled: boolean;
  sourceKind: 'PARSED' | 'MANUAL';
  sourceRow: number | null;
  updatedAt: string | null;
};

export type GeminiPadronDraft = {
  fileName: string;
  uploadedAt: string;
  sourceType: 'PDF_GEMINI' | 'IMAGE_GEMINI';
  analysisProvider: 'GEMINI_CLIENT';
  model: string | null;
  records: GeminiPadronDraftRecord[];
  observations: PadronImportError[];
};

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
    finishReason?: string;
  }>;
  promptFeedback?: {
    blockReason?: string;
  };
};

type GeminiRawResponse = {
  records?: unknown;
  observations?: unknown;
};

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const MAX_GEMINI_FILE_BYTES = 20 * 1024 * 1024;
const ENABLED_TRUE_VALUES = new Set(['1', 'true', 'si', 'sí', 'habilitado', 'activo']);
const ENABLED_FALSE_VALUES = new Set([
  '0',
  'false',
  'no',
  'inhabilitado',
  'deshabilitado',
  'inactivo',
]);

const PADRON_GEMINI_PROMPT = `
Analiza el documento adjunto del padrón electoral. El documento puede ser PDF o imagen.

Tu tarea es extraer SOLO una estructura JSON con esta forma exacta:
{
  "records": [
    { "carnet": "12345678", "habilitado": true }
  ],
  "observations": [
    { "message": "texto", "rowIndex": 3, "rawValue": "valor original" }
  ]
}

Reglas obligatorias:
1. Responde solo JSON válido. No agregues markdown, comentarios ni texto extra.
2. "records" debe contener solo filas entendibles con carnet y habilitación claros.
3. "observations" debe contener filas dudosas, incompletas, duplicadas, ruido, encabezados confusos o datos que no puedas interpretar con seguridad.
4. Interpreta la columna de habilitación así:
   - si, sí, habilitado, true, activo => true
   - no, inhabilitado, deshabilitado, false, inactivo => false
5. Ignora encabezados, numeración decorativa, títulos y texto que no sea una fila real del padrón.
6. Si el documento está en formato tabla o columnas, respeta el orden lógico de lectura.
7. No inventes carnets ni estados.
8. Si no estás seguro de una fila, envíala a "observations" en vez de asumir.
9. Mantén el carnet en formato legible; no agregues caracteres que no estén en el documento.
10. Si el documento no contiene filas útiles, devuelve "records": [] y explica el motivo en "observations".
`.trim();

@Injectable()
export class PadronGeminiImportService {
  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {}

  async analyzeDocument(file: {
    buffer: Buffer;
    originalname?: string;
    mimetype?: string;
    size?: number;
  }): Promise<GeminiPadronDraft> {
    const apiKey = this.configService.get<string>('app.ai.gemini.apiKey') ?? '';
    const model =
      this.configService.get<string>('app.ai.gemini.model') ?? DEFAULT_GEMINI_MODEL;

    if (!apiKey.trim()) {
      throw new InternalServerErrorException('No se pudo procesar el padrón. Intenta nuevamente.');
    }

    if (!file?.buffer?.length) {
      throw new BadRequestException('Archivo requerido');
    }

    if (file.buffer.length > MAX_GEMINI_FILE_BYTES) {
      throw new BadRequestException('El archivo supera el tamaño permitido.');
    }

    const mimeType = this.getMimeType(file);

    try {
      const response = await this.httpService.axiosRef.post<GeminiGenerateContentResponse>(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          model,
        )}:generateContent`,
        {
          systemInstruction: {
            parts: [{ text: 'Responde solo con JSON válido y no inventes datos del padrón.' }],
          },
          contents: [
            {
              role: 'user',
              parts: [
                { text: PADRON_GEMINI_PROMPT },
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: file.buffer.toString('base64'),
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                records: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      carnet: { type: 'STRING' },
                      habilitado: { type: 'BOOLEAN' },
                    },
                    required: ['carnet', 'habilitado'],
                  },
                },
                observations: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      message: { type: 'STRING' },
                      rowIndex: { type: 'NUMBER' },
                      rawValue: { type: 'STRING' },
                    },
                    required: ['message'],
                  },
                },
              },
              required: ['records', 'observations'],
            },
          },
        },
        {
          headers: {
            'x-goog-api-key': apiKey,
            'Content-Type': 'application/json',
          },
          timeout: 60000,
        },
      );

      const rawText = this.extractJsonText(response.data);
      const parsed = this.parseGeminiJson(rawText);
      const normalized = this.normalizeGeminiResult(parsed);

      return {
        fileName: file.originalname || 'padron',
        uploadedAt: new Date().toISOString(),
        sourceType: mimeType === 'application/pdf' ? 'PDF_GEMINI' : 'IMAGE_GEMINI',
        analysisProvider: 'GEMINI_CLIENT',
        model,
        records: normalized.records,
        observations: normalized.observations,
      };
    } catch (error) {
      console.error(error);
      if (error instanceof BadRequestException || error instanceof InternalServerErrorException) {
        throw error;
      }

      throw new BadRequestException('No se pudo procesar el padrón. Intenta nuevamente.');
    }
  }

  private getMimeType(file: { mimetype?: string; originalname?: string }) {
    const mimeType = String(file.mimetype ?? '').trim();
    if (mimeType) return mimeType;

    const lowerName = String(file.originalname ?? '').toLowerCase();
    if (lowerName.endsWith('.pdf')) return 'application/pdf';
    if (lowerName.endsWith('.png')) return 'image/png';
    if (lowerName.endsWith('.webp')) return 'image/webp';
    return 'image/jpeg';
  }

  private extractJsonText(response: GeminiGenerateContentResponse) {
    const text = response.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('')
      .trim();

    if (text) return text;

    if (response.promptFeedback?.blockReason) {
      throw new BadRequestException('No se pudo procesar el padrón. Intenta nuevamente.');
    }

    throw new BadRequestException('No se pudo obtener un resultado del documento.');
  }

  private parseGeminiJson(rawText: string): GeminiRawResponse {
    try {
      return JSON.parse(rawText) as GeminiRawResponse;
    } catch {
      const firstBrace = rawText.indexOf('{');
      const lastBrace = rawText.lastIndexOf('}');
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        return JSON.parse(rawText.slice(firstBrace, lastBrace + 1)) as GeminiRawResponse;
      }
      throw new BadRequestException('No se pudo interpretar el resultado del documento.');
    }
  }

  private normalizeGeminiResult(parsed: GeminiRawResponse): {
    records: GeminiPadronDraftRecord[];
    observations: PadronImportError[];
  } {
    const rawRecords = Array.isArray(parsed.records) ? parsed.records : [];
    const rawObservations = Array.isArray(parsed.observations) ? parsed.observations : [];
    const observations: PadronImportError[] = [];
    const records: GeminiPadronDraftRecord[] = [];
    const seenCarnets = new Set<string>();

    rawObservations.forEach((entry, index) => {
      const normalized = this.parseObservation(entry, index + 1);
      if (normalized) observations.push(normalized);
    });

    rawRecords.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        observations.push({
          code: 'INVALID_RECORD',
          message: 'Se detectó una fila con un formato que no se pudo interpretar.',
          rowIndex: index + 1,
          rawValue: String(entry ?? ''),
        });
        return;
      }

      const raw = entry as Record<string, unknown>;
      const carnet = normalizeCarnet(
        String(raw.carnet ?? raw.ci ?? raw.carnetIdentidad ?? ''),
      );
      if (!carnet) {
        observations.push({
          code: 'INVALID_CARNET',
          message: 'Se detectó una fila sin un carnet legible.',
          rowIndex: index + 1,
          rawValue: this.safeJson(raw),
        });
        return;
      }

      const enabled = this.parseEnabledValue(raw.habilitado ?? raw.enabled ?? raw.estado);
      if (enabled === null) {
        observations.push({
          code: 'INVALID_ENABLED_VALUE',
          message: 'No se pudo interpretar si el registro está habilitado o no.',
          rowIndex: index + 1,
          rawValue: this.safeJson(raw),
        });
        return;
      }

      if (seenCarnets.has(carnet)) {
        observations.push({
          code: 'DUPLICATE_CARNET',
          message: 'Se detectó un carnet duplicado.',
          rowIndex: index + 1,
          rawValue: carnet,
        });
        return;
      }

      seenCarnets.add(carnet);
      records.push({
        id: randomUUID(),
        carnet,
        enabled,
        sourceKind: 'PARSED',
        sourceRow: index + 1,
        updatedAt: null,
      });
    });

    if (!records.length && !observations.length) {
      observations.push({
        code: 'EMPTY_RESULT',
        message: 'No se pudieron extraer registros u observaciones del documento.',
        rowIndex: null,
        rawValue: null,
      });
    }

    return { records, observations };
  }

  private parseEnabledValue(value: unknown): boolean | null {
    if (typeof value === 'boolean') return value;

    const normalized = String(value ?? '').trim().toLowerCase();
    if (!normalized) return null;
    if (ENABLED_TRUE_VALUES.has(normalized)) return true;
    if (ENABLED_FALSE_VALUES.has(normalized)) return false;
    return null;
  }

  private parseObservation(value: unknown, fallbackIndex: number): PadronImportError | null {
    if (typeof value === 'string' && value.trim()) {
      return {
        code: 'GEMINI_OBSERVATION',
        message: value.trim(),
        rowIndex: fallbackIndex,
        rawValue: null,
      };
    }

    if (!value || typeof value !== 'object') return null;

    const raw = value as Record<string, unknown>;
    const message = String(raw.message ?? raw.reason ?? raw.error ?? '').trim();
    if (!message) return null;

    return {
      code: String(raw.code ?? 'GEMINI_OBSERVATION'),
      message,
      rowIndex:
        raw.rowIndex === null || raw.rowIndex === undefined || Number.isNaN(Number(raw.rowIndex))
          ? fallbackIndex
          : Number(raw.rowIndex),
      rawValue:
        raw.rawValue === null || raw.rawValue === undefined ? null : String(raw.rawValue),
    };
  }

  private safeJson(value: unknown) {
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }
}
