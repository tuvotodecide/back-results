import { RED_ENLACE_TIMEZONE_OFFSET } from '../payments.constants';

const LOCAL_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?$/;

/**
 * Red Enlace envia fechas ISO 8601 sin zona horaria (yyyy-MM-dd'T'HH:mm:ss)
 * en hora de Bolivia. Sin zona, `new Date()` las interpretaria en la hora del
 * servidor.
 */
export function parseRedEnlaceDateTime(value: unknown): Date | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const date = new Date(
    LOCAL_DATE_TIME_PATTERN.test(raw) ? `${raw}${RED_ENLACE_TIMEZONE_OFFSET}` : raw,
  );
  return Number.isNaN(date.getTime()) ? null : date;
}
