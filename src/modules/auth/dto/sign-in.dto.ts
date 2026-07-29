import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEmail, IsString, MinLength } from "class-validator";
import {
  TerritorialAccessStatus,
  UserRole,
  userRoles,
} from "../schemas/roledUser.schema";

export const tenantAccessStatuses = ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'REVOKED'] as const;
export type TenantAccessStatus = typeof tenantAccessStatuses[number];
export const tenantWalletStatuses = ['MISSING', 'VERIFIED'] as const;
export type TenantWalletStatus = typeof tenantWalletStatuses[number];

export class AuthContextDto {
  @ApiProperty({
    enum: ['GLOBAL_ADMIN', 'ACCESS_APPROVALS', 'TERRITORIAL', 'TENANT'],
  })
  type: 'GLOBAL_ADMIN' | 'ACCESS_APPROVALS' | 'TERRITORIAL' | 'TENANT';

  @ApiPropertyOptional({ enum: userRoles })
  role?: UserRole;

  @ApiPropertyOptional()
  label?: string;

  @ApiPropertyOptional()
  tenantId?: string | null;

  @ApiPropertyOptional()
  tenantName?: string | null;

  @ApiPropertyOptional()
  membershipId?: string | null;

  @ApiPropertyOptional()
  hasWallet?: boolean;

  @ApiPropertyOptional()
  requiresWalletUpdate?: boolean;

  @ApiPropertyOptional({ enum: tenantWalletStatuses })
  walletStatus?: TenantWalletStatus;

  @ApiPropertyOptional()
  votingDepartmentId?: string | null;

  @ApiPropertyOptional()
  votingMunicipalityId?: string | null;
}

export class TenantAccessItemDto {
  @ApiPropertyOptional()
  applicationId?: string | null;

  @ApiPropertyOptional()
  membershipId?: string | null;

  @ApiProperty({ enum: tenantAccessStatuses })
  status: TenantAccessStatus;

  @ApiPropertyOptional()
  tenantId?: string | null;

  @ApiPropertyOptional()
  tenantName?: string | null;

  @ApiPropertyOptional()
  reason?: string | null;

  @ApiPropertyOptional()
  hasWallet?: boolean;

  @ApiPropertyOptional()
  requiresWalletUpdate?: boolean;

  @ApiPropertyOptional({ enum: tenantWalletStatuses })
  walletStatus?: TenantWalletStatus;
}

export class TenantAccessSummaryDto {
  @ApiProperty()
  hasApprovedAccess: boolean;

  @ApiPropertyOptional()
  latestStatus?: TenantAccessStatus | null;

  @ApiProperty()
  canRequest: boolean;

  @ApiProperty()
  shouldSelectTenantContext: boolean;

  @ApiProperty()
  message: string;

  @ApiProperty({ type: [TenantAccessItemDto] })
  items: TenantAccessItemDto[];
}

export class TerritorialAccessSummaryDto {
  @ApiProperty()
  hasApprovedAccess: boolean;

  @ApiProperty({ enum: ['NONE', 'PENDING_EMAIL_VERIFICATION', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'REVOKED'] })
  status: TerritorialAccessStatus;

  @ApiPropertyOptional({ enum: ['MAYOR', 'GOVERNOR'] })
  requestedRole?: 'MAYOR' | 'GOVERNOR' | null;

  @ApiPropertyOptional()
  votingDepartmentId?: string | null;

  @ApiPropertyOptional()
  votingMunicipalityId?: string | null;

  @ApiPropertyOptional()
  reason?: string | null;

  @ApiProperty()
  canRequest: boolean;

  @ApiProperty()
  message: string;
}

export class AccessStatusDto {
  @ApiProperty({ type: TenantAccessSummaryDto })
  tenant: TenantAccessSummaryDto;

  @ApiProperty({ type: TerritorialAccessSummaryDto })
  territorial: TerritorialAccessSummaryDto;
}

export class SignInDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ minLength: 8, example: 'secret123' })
  @IsString()
  @MinLength(8)
  password: string;
}

export class SignInResponseDto {
  @ApiProperty() accessToken: string;
  @ApiProperty({ enum: userRoles }) role: UserRole;
  @ApiProperty() active: boolean;
  @ApiPropertyOptional() tenantId?: string | null;
  @ApiProperty({ type: [AuthContextDto] }) availableContexts: AuthContextDto[];
  @ApiProperty() requiresContextSelection: boolean;
  @ApiPropertyOptional({ type: AuthContextDto }) defaultContext?: AuthContextDto | null;
  @ApiProperty({ type: AccessStatusDto }) accessStatus: AccessStatusDto;
}

export class ProfileResponseDto {
  @ApiProperty() sub: string;
  @ApiProperty() dni: string;
  @ApiProperty({ enum: userRoles }) role: UserRole;
  @ApiProperty() active: boolean;
  @ApiPropertyOptional() votingDepartmentId: string;
  @ApiPropertyOptional() votingMunicipalityId: string;
  @ApiPropertyOptional() tenantId?: string | null;
  @ApiProperty({ description: 'Timestamp: fecha de emisión' }) iat: number;
  @ApiProperty({ description: 'Timestamp: fecha de expiración' }) exp: number;
}
