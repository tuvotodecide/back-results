import { BadRequestException } from '@nestjs/common';

const RED_ENLACE_GLOSA_MAX_LENGTH = 60;

/**
 * En QR Simple v2 los datos del comercio viajan en idEstablecimiento y
 * nombreEstablecimiento; la glosa es solo la descripcion del cobro.
 */
export function buildRedEnlaceGlosa(customerGloss: string): string {
  const glosa = String(customerGloss ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!glosa) {
    throw new BadRequestException('Glosa requerida');
  }
  if (glosa.length > RED_ENLACE_GLOSA_MAX_LENGTH) {
    throw new BadRequestException('Glosa excede longitud maxima');
  }
  return glosa;
}

export function sanitizeProviderDetail(value?: string | null): string | null {
  const normalized = String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!normalized) return null;
  return normalized.slice(0, 240);
}
