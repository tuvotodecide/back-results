export function randomNumericString(minDigits: number, maxDigits: number): string {
  const digits = Math.floor(Math.random() * (maxDigits - minDigits + 1)) + minDigits;
  const lower = 10 ** (digits - 1);
  const upper = 10 ** digits - 1;
  return Math.floor(Math.random() * (upper - lower + 1) + lower).toString();
}

export function randomPhone(): string {
  return `7${randomNumericString(7, 7)}`;
}

export function generateUniqueStrings(count: number, generator: () => string): string[] {
  const set = new Set<string>();
  while (set.size < count) {
    set.add(generator());
  }
  return Array.from(set);
}