export class TimezoneUtil {
  /**
   * Convierte fecha Bolivia a UTC
   */
  static boliviaToUTC(boliviaDateString: string): Date {
    const boliviaDate = new Date(boliviaDateString);

    const utcDate = new Date(boliviaDate.getTime() + 4 * 60 * 60 * 1000);

    return utcDate;
  }

  /**
   * Convierte UTC a Bolivia para mostrar
   */
  static utcToBolivia(utcDate: Date): string {
    const boliviaDate = new Date(utcDate.getTime() - 4 * 60 * 60 * 1000);
    return boliviaDate.toISOString().slice(0, 16); // "YYYY-MM-DDTHH:mm"
  }
}
