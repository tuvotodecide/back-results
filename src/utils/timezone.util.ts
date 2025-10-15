export class TimezoneUtil {
  private static readonly OFFSET_MS = 4 * 60 * 60 * 1000; // Bolivia UTC-4

  // "YYYY-MM-DDTHH:mm[:ss]" en hora Bolivia -> Date UTC
  static boliviaToUTC(local: string): Date {
    if (typeof local !== 'string' || !local.trim()) throw new Error('Fecha vacía');
    const m = local.trim().match(
      /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/
    );
    if (!m) {
      const d = new Date(local);
      if (isNaN(d.getTime())) throw new Error('Formato de fecha inválido');
      return d;
    }
    const [_, y, mo, da, h, mi, s] = m;
    return new Date(Date.UTC(+y, +mo - 1, +da, +h + 4, +mi, +(s ?? 0)));
  }

  // UTC -> "YYYY-MM-DDTHH:mm" (Bolivia). Tolera undefined/null/fechas inválidas.
  static utcToBoliviaSafe(input?: Date | string | null): string {
    if (!input) return '';
    const d = input instanceof Date ? input : new Date(input);
    if (isNaN(d.getTime())) return '';
    const bz = new Date(d.getTime() - this.OFFSET_MS);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${bz.getUTCFullYear()}-${pad(bz.getUTCMonth() + 1)}-${pad(bz.getUTCDate())}T${pad(bz.getUTCHours())}:${pad(bz.getUTCMinutes())}`;
  }
}
