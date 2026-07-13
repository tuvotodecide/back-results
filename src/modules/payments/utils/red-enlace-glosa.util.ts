import { BadRequestException } from '@nestjs/common';

export interface BuildRedEnlaceGlosaInput {
  branchCode: string;
  branchName: string;
  businessCategory: string;
  customerGloss: string;
}

function sanitizeGlosaField(value: string, maxLength: number, field: string) {
  const normalized = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!normalized) {
    throw new BadRequestException(`${field} requerido`);
  }
  if (normalized.includes('|')) {
    throw new BadRequestException(`${field} no puede contener separador`);
  }
  if (normalized.length > maxLength) {
    throw new BadRequestException(`${field} excede longitud maxima`);
  }
  return normalized;
}

export function buildRedEnlaceGlosa(input: BuildRedEnlaceGlosaInput): string {
  const branchCode = sanitizeGlosaField(input.branchCode, 10, 'CodSucursal');
  const branchName = sanitizeGlosaField(input.branchName, 50, 'NombreSucursal');
  const businessCategory = sanitizeGlosaField(
    input.businessCategory,
    10,
    'RubroComercio',
  );
  const customerGloss = sanitizeGlosaField(
    input.customerGloss,
    60,
    'GlosaCliente',
  );

  const glosa = [
    branchCode,
    branchName,
    businessCategory,
    customerGloss,
  ].join('|');

  if (glosa.length > 130) {
    throw new BadRequestException('Glosa excede longitud maxima');
  }

  return glosa;
}

export function sanitizeProviderDetail(value?: string | null): string | null {
  const normalized = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!normalized) return null;
  return normalized.slice(0, 240);
}
