import { BadRequestException } from '@nestjs/common';

type ColorPaletteInput = {
  color?: string | null;
  colors?: string[] | null;
};

type ResolveColorPaletteOptions = {
  requireAtLeastOne?: boolean;
  fieldLabel?: string;
};

const HEX_COLOR_REGEX = /^#(?:[0-9A-F]{3}|[0-9A-F]{6})$/i;

function normalizeSingleColor(value: string) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    throw new BadRequestException('Los colores no pueden estar vacios');
  }
  if (!HEX_COLOR_REGEX.test(trimmed)) {
    throw new BadRequestException(`Color invalido: ${trimmed}`);
  }
  return `#${trimmed.slice(1).toUpperCase()}`;
}

function dedupePreserveOrder(colors: string[]) {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const color of colors) {
    if (seen.has(color)) continue;
    seen.add(color);
    normalized.push(color);
  }

  return normalized;
}

export function resolveColorPaletteInput(
  input: ColorPaletteInput,
  options: ResolveColorPaletteOptions = {},
) {
  const fieldLabel = options.fieldLabel ?? 'colors';

  let palette: string[] = [];

  if (Array.isArray(input.colors)) {
    if (input.colors.length === 0) {
      throw new BadRequestException(`${fieldLabel} no puede ser un array vacio`);
    }
    palette = input.colors.map((color) => normalizeSingleColor(color));
  } else if (typeof input.color === 'string' && input.color.trim()) {
    palette = [normalizeSingleColor(input.color)];
  }

  palette = dedupePreserveOrder(palette);

  if (options.requireAtLeastOne && palette.length === 0) {
    throw new BadRequestException(`Debe proporcionar al menos un color valido en ${fieldLabel} o color`);
  }

  return {
    colors: palette,
    color: palette[0] ?? null,
  };
}

export function readColorPalette(input: ColorPaletteInput) {
  const rawColors = Array.isArray(input.colors) ? input.colors : [];
  const normalizedColors = dedupePreserveOrder(
    rawColors
      .map((color) => String(color ?? '').trim())
      .filter((color) => HEX_COLOR_REGEX.test(color))
      .map((color) => `#${color.slice(1).toUpperCase()}`),
  );

  if (normalizedColors.length > 0) {
    return {
      colors: normalizedColors,
      color: normalizedColors[0],
    };
  }

  if (typeof input.color === 'string' && HEX_COLOR_REGEX.test(input.color.trim())) {
    const normalized = `#${input.color.trim().slice(1).toUpperCase()}`;
    return {
      colors: [normalized],
      color: normalized,
    };
  }

  return {
    colors: [],
    color: null,
  };
}
