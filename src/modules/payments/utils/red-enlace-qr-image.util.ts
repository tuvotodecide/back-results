export const RED_ENLACE_MAX_QR_IMAGE_BYTES_DEFAULT = 1024 * 1024;

const DATA_URI_BASE64_PATTERN =
  /^data:image\/(?:png|jpe?g);base64,(?<data>.+)$/i;

export function validateRedEnlaceQrImage(
  value: unknown,
  maxBytes = RED_ENLACE_MAX_QR_IMAGE_BYTES_DEFAULT,
) {
  if (typeof value !== 'string') {
    throw new Error('RED_ENLACE_QR_IMAGE_INVALID');
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('RED_ENLACE_QR_IMAGE_INVALID');
  }

  const dataUriMatch = DATA_URI_BASE64_PATTERN.exec(trimmed);
  if (trimmed.toLowerCase().startsWith('data:') && !dataUriMatch) {
    throw new Error('RED_ENLACE_QR_IMAGE_INVALID');
  }

  const payload = dataUriMatch?.groups?.data ?? trimmed;
  const normalized = payload.replace(/\s/g, '');
  if (!normalized || normalized.length % 4 !== 0) {
    throw new Error('RED_ENLACE_QR_IMAGE_INVALID');
  }

  const buffer = Buffer.from(normalized, 'base64');
  if (!buffer.length || buffer.toString('base64').replace(/=+$/, '') !== normalized.replace(/=+$/, '')) {
    throw new Error('RED_ENLACE_QR_IMAGE_INVALID');
  }
  if (maxBytes > 0 && buffer.length > maxBytes) {
    throw new Error('RED_ENLACE_QR_IMAGE_TOO_LARGE');
  }

  return trimmed;
}
