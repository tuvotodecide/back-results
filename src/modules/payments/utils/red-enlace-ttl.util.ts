export const RED_ENLACE_QR_TTL_MAX_SECONDS = 8760 * 60 * 60;

export interface RedEnlaceQrTtl {
  seconds: number;
  milliseconds: number;
}

export function parseRedEnlaceQrTtl(value: string): RedEnlaceQrTtl {
  if (!/^\d{2,}:\d{2}:\d{2}$/.test(value)) {
    throw new Error('RED_ENLACE_QR_TTL must use HH:MM:SS format');
  }

  const [hours, minutes, seconds] = value.split(':').map((part) => Number(part));
  if (minutes > 59 || seconds > 59) {
    throw new Error('RED_ENLACE_QR_TTL minutes and seconds must be between 00 and 59');
  }

  const totalSeconds = hours * 60 * 60 + minutes * 60 + seconds;
  if (totalSeconds <= 0) {
    throw new Error('RED_ENLACE_QR_TTL must be greater than zero');
  }
  if (totalSeconds > RED_ENLACE_QR_TTL_MAX_SECONDS) {
    throw new Error('RED_ENLACE_QR_TTL must not exceed 8760:00:00');
  }

  return {
    seconds: totalSeconds,
    milliseconds: totalSeconds * 1000,
  };
}
