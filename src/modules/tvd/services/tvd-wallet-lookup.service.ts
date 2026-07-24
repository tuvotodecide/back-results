import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { getAddress, isAddress, zeroAddress } from 'viem';
import {
  RoledUser,
  RoledUserDocument,
} from '@/modules/auth/schemas/roledUser.schema';
import {
  InstitutionalTenant,
  InstitutionalTenantDocument,
} from '@/modules/institutional-tenants/schemas/institutional-tenant.schema';
import {
  TenantAdminAssignment,
  TenantAdminAssignmentDocument,
} from '@/modules/institutional-tenants/schemas/tenant-admin-assignment.schema';
import {
  getTenantWalletVerificationState,
  normalizeTenantWalletAddress,
} from '@/modules/institutional-tenants/utils/tenant-wallet-verification.util';
import {
  TvdWalletAssociationStatus,
  TvdWalletLookupInstitutionSummary,
  TvdWalletLookupReasonCode,
  TvdWalletLookupResponseDto,
} from '../dto/tvd-wallet-lookup.dto';

type IdentityByAccountResponse =
  | {
      ok: true;
      record?: {
        accountAddress?: string | null;
      } | null;
    }
  | {
      ok: false;
      error?: string | null;
    };

type AssignmentRow = {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  status?: string | null;
  active?: boolean | null;
  accountAddress?: string | null;
  accountAddressNormalized?: string | null;
  institutionalRole?: string | null;
  walletVerifiedAt?: Date | string | null;
  walletVerificationSource?: string | null;
};

type TenantRow = {
  _id: Types.ObjectId;
  name?: string | null;
  active?: boolean | null;
};

type UserRow = {
  _id: Types.ObjectId;
  active?: boolean | null;
};

@Injectable()
export class TvdWalletLookupService {
  private readonly context = 'TvdWalletLookupService';
  private readonly logger = new Logger(TvdWalletLookupService.name);

  constructor(
    @InjectModel(TenantAdminAssignment.name)
    private readonly assignmentModel: Model<TenantAdminAssignmentDocument>,
    @InjectModel(InstitutionalTenant.name)
    private readonly tenantModel: Model<InstitutionalTenantDocument>,
    @InjectModel(RoledUser.name)
    private readonly userModel: Model<RoledUserDocument>,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async lookupAdminWallet(
    accountAddress: string,
    requester?: { sub?: string; role?: string; active?: boolean },
  ): Promise<TvdWalletLookupResponseDto> {
    const normalizedAddress = this.normalizeAccountAddress(accountAddress);
    const [identity, associations] = await Promise.all([
      this.lookupIdentity(normalizedAddress),
      this.lookupLocalAssociations(normalizedAddress),
    ]);

    const associationStatus = this.resolveAssociationStatus(associations);
    const reasonCode = this.resolveReasonCode(identity.registered, associationStatus);
    const response: TvdWalletLookupResponseDto = {
      accountAddress: normalizedAddress,
      registeredInIdentity: identity.registered,
      identityStatus: identity.registered ? 'REGISTERED' : 'NOT_REGISTERED',
      associationStatus,
      canUse: this.resolveCanUse(identity.registered, associationStatus),
      reasonCode,
      associations,
    };

    this.logger.log(
      {
        event: 'tvd_admin_wallet_lookup',
        requesterUserId: requester?.sub ?? null,
        requesterRole: requester?.role ?? null,
        accountAddress: normalizedAddress,
        identityStatus: response.identityStatus,
        associationStatus: response.associationStatus,
        reasonCode: response.reasonCode,
        associationsCount: response.associations.length,
      },
      this.context,
    );

    return response;
  }

  normalizeAccountAddress(value: string) {
    const trimmed = String(value ?? '').trim();
    if (!trimmed || !isAddress(trimmed)) {
      throw new BadRequestException({
        code: 'TVD_WALLET_INVALID_ADDRESS',
        message: 'La direccion de wallet no es valida.',
      });
    }
    const address = getAddress(trimmed);
    if (address === zeroAddress) {
      throw new BadRequestException({
        code: 'TVD_WALLET_INVALID_ADDRESS',
        message: 'La direccion de wallet no es valida.',
      });
    }
    return address;
  }

  private async lookupIdentity(accountAddress: string) {
    const baseUrl = String(
      this.configService.get<string>('app.identity.baseUrl') ?? '',
    ).trim();
    const apiKey = String(
      this.configService.get<string>('app.identity.apiKey') ?? '',
    ).trim();
    const timeout = this.configService.get<number>('IDENTITY_HTTP_TIMEOUT_MS', 5000);

    if (!baseUrl || !apiKey) {
      throw new ServiceUnavailableException({
        code: 'TVD_IDENTITY_UNAVAILABLE',
        message: 'No pudimos validar la wallet. Intenta nuevamente.',
      });
    }

    try {
      const response = await this.httpService.axiosRef.get<IdentityByAccountResponse>(
        `${baseUrl.replace(/\/$/, '')}/registry/by-account`,
        {
          params: { accountAddress },
          headers: { 'x-api-key': apiKey },
          timeout,
        },
      );
      return this.parseIdentityResponse(response.data, accountAddress);
    } catch (error) {
      if (
        error instanceof ServiceUnavailableException ||
        error instanceof BadGatewayException
      ) {
        throw error;
      }
      throw new ServiceUnavailableException({
        code: 'TVD_IDENTITY_UNAVAILABLE',
        message: 'No pudimos validar la wallet. Intenta nuevamente.',
      });
    }
  }

  private parseIdentityResponse(
    data: IdentityByAccountResponse,
    accountAddress: string,
  ) {
    if (!data || typeof data.ok !== 'boolean') {
      throw new BadGatewayException({
        code: 'TVD_IDENTITY_INVALID_RESPONSE',
        message: 'No pudimos validar la wallet. Intenta nuevamente.',
      });
    }

    if (!data.ok) {
      if (data.error === 'not-found') {
        return { registered: false };
      }
      throw new BadGatewayException({
        code: 'TVD_IDENTITY_INVALID_RESPONSE',
        message: 'No pudimos validar la wallet. Intenta nuevamente.',
      });
    }

    const identityAddress = data.record?.accountAddress;
    if (!identityAddress || normalizeTenantWalletAddress(identityAddress) !== accountAddress) {
      throw new BadGatewayException({
        code: 'TVD_IDENTITY_INVALID_RESPONSE',
        message: 'No pudimos validar la wallet. Intenta nuevamente.',
      });
    }

    return { registered: true };
  }

  private async lookupLocalAssociations(
    accountAddress: string,
  ): Promise<TvdWalletLookupInstitutionSummary[]> {
    const normalized = accountAddress.toLowerCase();
    const assignments = await this.assignmentModel
      .find({
        $or: [
          { accountAddressNormalized: normalized },
          { accountAddress: this.exactAddressRegex(accountAddress) },
        ],
      })
      .lean<AssignmentRow[]>();

    if (!assignments.length) {
      return [];
    }

    const tenantIds = assignments.map((assignment) => assignment.tenantId);
    const userIds = assignments.map((assignment) => assignment.userId);
    const [tenants, users] = await Promise.all([
      this.tenantModel
        .find({ _id: { $in: tenantIds } }, { name: 1, active: 1 })
        .lean<TenantRow[]>(),
      this.userModel
        .find({ _id: { $in: userIds } }, { active: 1 })
        .lean<UserRow[]>(),
    ]);
    const tenantById = new Map(
      tenants.map((tenant) => [String(tenant._id), tenant]),
    );
    const userById = new Map(users.map((user) => [String(user._id), user]));

    return assignments.map((assignment) => {
      const tenant = tenantById.get(String(assignment.tenantId));
      const user = userById.get(String(assignment.userId));
      const walletState = getTenantWalletVerificationState(assignment);
      return {
        tenantId: String(assignment.tenantId),
        tenantName: tenant?.name ?? 'Institucion no disponible',
        tenantActive: tenant?.active === true,
        assignmentId: String(assignment._id),
        userId: String(assignment.userId),
        institutionalRole: assignment.institutionalRole ?? null,
        assignmentStatus: assignment.status ?? null,
        assignmentActive: assignment.active === true,
        userActive: typeof user?.active === 'boolean' ? user.active : null,
        walletStatus: walletState.walletStatus,
        walletVerifiedAt: assignment.walletVerifiedAt ?? null,
        walletVerificationSource: assignment.walletVerificationSource ?? null,
      };
    });
  }

  private resolveAssociationStatus(
    associations: TvdWalletLookupInstitutionSummary[],
  ): TvdWalletAssociationStatus {
    if (!associations.length) return 'UNASSOCIATED';
    if (associations.length > 1) return 'INCONSISTENT';

    const [association] = associations;
    const isApproved = association.assignmentStatus === 'APPROVED';
    const isOperational =
      association.tenantActive &&
      association.assignmentActive &&
      association.userActive === true &&
      isApproved &&
      association.walletStatus === 'VERIFIED';

    if (isOperational) return 'ASSOCIATED';
    if (
      !association.tenantActive ||
      !association.assignmentActive ||
      association.userActive === false
    ) {
      return 'DISABLED';
    }
    return 'INCOMPATIBLE';
  }

  private resolveCanUse(
    registeredInIdentity: boolean,
    associationStatus: TvdWalletAssociationStatus,
  ) {
    if (!registeredInIdentity) return false;
    return associationStatus === 'UNASSOCIATED' || associationStatus === 'ASSOCIATED';
  }

  private resolveReasonCode(
    registeredInIdentity: boolean,
    associationStatus: TvdWalletAssociationStatus,
  ): TvdWalletLookupReasonCode {
    if (!registeredInIdentity) return 'WALLET_NOT_REGISTERED';
    if (associationStatus === 'UNASSOCIATED') return 'WALLET_AVAILABLE';
    if (associationStatus === 'ASSOCIATED') return 'WALLET_ASSOCIATED';
    if (associationStatus === 'DISABLED') return 'WALLET_DISABLED';
    if (associationStatus === 'INCONSISTENT') return 'WALLET_INCONSISTENT';
    return 'WALLET_INCOMPATIBLE';
  }

  private exactAddressRegex(accountAddress: string) {
    return new RegExp(
      `^${accountAddress.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
      'i',
    );
  }
}
