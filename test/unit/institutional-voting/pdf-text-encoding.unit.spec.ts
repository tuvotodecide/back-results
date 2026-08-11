import { escapePdfTextWinAnsi } from '@/modules/institutional-voting/services/pdf/pdf-text-encoding';

describe('PDF WinAnsi text encoding', () => {
  it('serializa á é í ó ú ñ y mayúsculas como escapes compatibles con Helvetica WinAnsi', () => {
    expect(escapePdfTextWinAnsi('áéíóúñ ÁÉÍÓÚÑ')).toBe(
      '\\341\\351\\355\\363\\372\\361 \\301\\311\\315\\323\\332\\321',
    );
  });

  it('conserva escapes de literales PDF sin convertir texto a ASCII', () => {
    expect(escapePdfTextWinAnsi('Padrón (vigente) \\ lista')).toBe(
      'Padr\\363n \\(vigente\\) \\\\ lista',
    );
  });
});
