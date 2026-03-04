export function normalizeCarnet(raw: string | undefined | null): string {
  return String(raw ?? '')
    .trim()
    .replace(/[\s.\-]/g, '')
    .toUpperCase();
}
