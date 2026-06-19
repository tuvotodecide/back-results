export function normalizeCarnet(raw: string | undefined | null): string {
  const normalized = String(raw ?? '')
    .trim()
    .replace(/[\s.-]/g, '')
    .toUpperCase();

  if (!normalized) {
    return '';
  }

  if (!/^[A-Z0-9]+$/.test(normalized)) {
    return '';
  }

  if (!/\d/.test(normalized)) {
    return '';
  }

  if (normalized.length < 5 || normalized.length > 20) {
    return '';
  }

  return normalized;
}
