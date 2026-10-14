import { IsEnum, IsOptional } from 'class-validator';

const mockStatuses = [
  'PENDIENTE',
  'PAGADO',
  'EXPIRADO',
  'CANCELADO',
  // Alias v1, se traducen a los estados v2 en el mock.
  'PENDING',
  'SUCCESS',
  'CLOSED',
  'EXPIRED',
  'CANCELLED',
  'ERROR',
  'NOTFOUND',
] as const;

export type MockRedEnlaceStatus = typeof mockStatuses[number];

export class ReconcilePaymentDto {
  @IsOptional()
  @IsEnum(mockStatuses)
  mockStatus?: MockRedEnlaceStatus;
}
