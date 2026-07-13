import { IsEnum, IsOptional } from 'class-validator';

const mockStatuses = [
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
