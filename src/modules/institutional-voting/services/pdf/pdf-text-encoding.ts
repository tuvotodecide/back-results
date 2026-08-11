const WIN_ANSI_ESCAPES: Record<string, string> = {
  á: '\\341',
  é: '\\351',
  í: '\\355',
  ó: '\\363',
  ú: '\\372',
  Á: '\\301',
  É: '\\311',
  Í: '\\315',
  Ó: '\\323',
  Ú: '\\332',
  ñ: '\\361',
  Ñ: '\\321',
  ü: '\\374',
  Ü: '\\334',
};

/**
 * Serializes text for PDF Type1 fonts declared with /WinAnsiEncoding.
 *
 * PDF literals cannot carry UTF-8 bytes for a standard Type1 font. The octal
 * escapes below identify the matching single-byte glyphs in WinAnsiEncoding.
 */
export function escapePdfTextWinAnsi(value: string): string {
  return Array.from(String(value))
    .map((char) => {
      if (char === '\\') return '\\\\';
      if (char === '(') return '\\(';
      if (char === ')') return '\\)';
      if (WIN_ANSI_ESCAPES[char]) return WIN_ANSI_ESCAPES[char];
      const code = char.charCodeAt(0);
      return code >= 0x20 && code <= 0x7e ? char : '';
    })
    .join('');
}
