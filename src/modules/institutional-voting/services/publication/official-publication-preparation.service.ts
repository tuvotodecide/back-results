import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { Model, Types } from 'mongoose';
import {
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  hexToBigInt,
  isHex,
  keccak256,
} from 'viem';
import { TVD_TOKEN_ABI } from '@/modules/tvd/contracts/tvd-abis';
import { entryPoint06Address } from 'viem/account-abstraction';
import { TvdBlockchainService } from '@/modules/tvd/services/tvd-blockchain.service';
import { PadronVersion, PadronVersionDocument } from '../../schemas/padron-version.schema';
import { VotingEvent, VotingEventDocument } from '../../schemas/voting-event.schema';
import { VotingOption, VotingOptionDocument } from '../../schemas/voting-option.schema';
import { InstitutionalVotingAccessService } from '../core/institutional-voting-access.service';
import { IssuerService } from '../core/issuer.service';
import { PadronUsersService } from '../core/padron-users.service';
import { VoteWritterService } from '../core/vote-writter.service';
import { PadronService } from '../padron/padron.service';
import { OfficialPublicationArtifactsService } from './official-publication-artifacts.service';
import { OfficialPublicationRequestService } from './official-publication-request.service';

const DEFAULT_APPROVAL_TTL_MS = 30 * 60 * 1000;

@Injectable()
export class OfficialPublicationPreparationService {
  constructor(
    @InjectModel(VotingEvent.name)
    private readonly votingEventModel: Model<VotingEventDocument>,
    @InjectModel(VotingOption.name)
    private readonly votingOptionModel: Model<VotingOptionDocument>,
    @InjectModel(PadronVersion.name)
    private readonly padronVersionModel: Model<PadronVersionDocument>,
    private readonly accessService: InstitutionalVotingAccessService,
    private readonly padronService: PadronService,
    private readonly padronUsersService: PadronUsersService,
    private readonly issuerService: IssuerService,
    private readonly voteWritterService: VoteWritterService,
    private readonly tvdBlockchainService: TvdBlockchainService,
    private readonly requestService: OfficialPublicationRequestService,
    private readonly artifactsService: OfficialPublicationArtifactsService,
  ) {}

  async prepareOfficialPublication(eventId: string, requester: any) {
    const existing = await this.requestService.getActiveRequestByEventId(eventId);
    if (existing) {
      return {
        request: existing,
        reused: true,
      };
    }

    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);
    this.assertCanPrepare(event);

    const publicationInstitution =
      await this.accessService.resolveOfficialPublicationInstitution(event, requester);

    await this.padronService.removeUnregisteredStagingEntriesForOfficialPublication(
      eventId,
      requester,
    );
    await this.padronService.materializeActiveDraftVersion(eventId, requester, {
      comparisonStatus: 'OK',
      deactivateDraft: false,
      markConfirmed: false,
      certificateMode: 'ON_CONFIRMATION',
    });

    const currentPadron = await this.padronVersionModel
      .findOne({ eventId: event._id, isCurrent: true })
      .lean();
    if (!currentPadron) {
      throw new BadRequestException({
        code: 'OFFICIAL_PUBLICATION_PADRON_MISSING',
        message: 'No existe un padron confirmado para preparar la publicacion',
      });
    }

    const convotatedUsers = (
      await this.padronUsersService.getPadronUsersFromEvent(event, {
        includeDisabled: false,
      })
    ).map((user) => String(user.dni));
    if (convotatedUsers.length === 0) {
      throw new BadRequestException({
        code: 'OFFICIAL_PUBLICATION_EMPTY_VOTERS',
        message: 'La publicacion oficial requiere votantes habilitados',
      });
    }

    const activeOptions = await this.votingOptionModel
      .find({ eventId: event._id, active: true })
      .lean();
    if (activeOptions.length === 0) {
      throw new BadRequestException({
        code: 'OFFICIAL_PUBLICATION_EMPTY_OPTIONS',
        message: 'La publicacion oficial requiere opciones activas',
      });
    }

    const dids = await this.issuerService.getDidsByDnis(convotatedUsers);
    if (dids.length !== convotatedUsers.length) {
      throw new BadRequestException({
        code: 'OFFICIAL_PUBLICATION_DID_MISSING',
        message: 'No se pueden emitir credenciales para todos los usuarios convocados',
      });
    }

    const options = activeOptions.map((option) => String(option.name));
    const preparedVote = await this.voteWritterService.prepareCreateVote(
      event,
      publicationInstitution.institutionId,
      convotatedUsers,
      options,
    );
    const requiredCredits = BigInt(convotatedUsers.length);
    const preflight = await this.tvdBlockchainService.validateVotePublicationPreflight({
      institutionWallet: publicationInstitution.accountAddress,
      institutionId: publicationInstitution.institutionId,
      onChainElectionId: preparedVote.onChainElectionId,
      requiredCredits,
      createVoteArgs: preparedVote.createVoteArgs,
    });
    const allowanceBefore = preflight.allowanceSmallestUnit ?? '0';
    const walletDebitRequired =
      preflight.walletDebitRequiredSmallestUnit ?? preflight.requiredTvd;
    const hasRequiredAllowance =
      preflight.hasRequiredAllowance ?? BigInt(allowanceBefore) >= BigInt(walletDebitRequired);

    const executionPackage = this.buildExecutionPackage({
      chainId: preflight.chainId,
      smartAccountAddress: publicationInstitution.smartAccountAddress,
      tokenAddress: preflight.tokenAddress,
      spenderAddress: preflight.spenderAddress,
      allowanceBefore,
      walletDebitRequired,
      createVoteCall: preparedVote.callData,
      approveRequired: !hasRequiredAllowance,
    });
    const callDataHash = executionPackage.callsHash;
    const optionsHash = this.hashJson(options);
    const votersDigest = this.hashJson(convotatedUsers);
    const snapshotHash = this.hashJson({
      eventId,
      institutionId: publicationInstitution.institutionId,
      padronVersionId: String(currentPadron._id),
      votersDigest,
      votersCount: convotatedUsers.length,
      optionsHash,
      ciMerkleRoot: preparedVote.ciMerkleTree.root.toString(),
      voteMerkleRoot: preparedVote.voteMerkleTree.root.toString(),
      callDataHash,
    });

    const expiresAt = new Date(Date.now() + DEFAULT_APPROVAL_TTL_MS);
    const createResult = await this.requestService.createOrGetActiveRequest({
      eventId: event._id,
      tenantId: event.tenantId,
      institutionId: publicationInstitution.institutionId,
      applicationId: publicationInstitution.applicationId,
      requestedByUserId: requester.sub,
      signerUserId: publicationInstitution.signerUserId,
      assignmentId: publicationInstitution.assignmentId,
      signerWallet: publicationInstitution.accountAddress,
      smartAccountAddress: publicationInstitution.smartAccountAddress,
      ownerWalletAddress: null,
      chainId: preflight.chainId,
      entryPoint: entryPoint06Address,
      entryPointAddress: entryPoint06Address,
      entryPointVersion: '0.6',
      onChainElectionId: preparedVote.onChainElectionId.toString(),
      expiresAt,
      callData: {
        to: preparedVote.callData.to,
        value: preparedVote.callData.value.toString(),
        data: preparedVote.callData.data,
      },
      callDataHash,
      executionCalls: executionPackage.calls,
      executionMode: executionPackage.executionMode,
      callsHash: executionPackage.callsHash,
      callsCount: executionPackage.calls.length,
      executionPackageVersion: 2,
      approveRequired: executionPackage.approveRequired,
      allowanceBefore,
      walletDebitRequired,
      snapshotHash,
      proxyAddress: preflight.proxyAddress,
      implementationAddress: preflight.implementationAddress,
      abiVersion: 'voteContract.createVote.v1',
      padronVersionId: currentPadron._id as Types.ObjectId,
      enabledVotersCount: convotatedUsers.length,
      optionsHash,
      merkleRoots: {
        ciMerkleRoot: preparedVote.ciMerkleTree.root.toString(),
        voteMerkleRoot: preparedVote.voteMerkleTree.root.toString(),
      },
      nullifiersRef: {
        storage: 'official_publication_artifacts',
        ref: snapshotHash,
        digest: this.hashJson(preparedVote.secrets),
        count: preparedVote.secrets.length,
      },
      creditsRequired: requiredCredits.toString(),
      tvdRequired: preflight.requiredTvd,
      tvdPerCredit: preflight.tvdPerCredit,
      tokenSource: 'TVD_CREDITS_CONTRACT',
      spender: preflight.spenderAddress,
    });

    if (!createResult.created) {
      return {
        request: createResult.request,
        reused: true,
      };
    }

    try {
      const artifact = await this.artifactsService.saveArtifact({
        requestId: createResult.request.requestId,
        eventId: event._id,
        tenantId: event.tenantId,
        institutionId: publicationInstitution.institutionId,
        snapshotHash,
        voters: convotatedUsers,
        dids,
        preparedVote,
      });
      await this.requestService.attachPreparedArtifact(
        createResult.request.requestId,
        artifact._id,
      );
      const request = await this.requestService.markPrepared(
        createResult.request.requestId,
        this.actorFrom(requester),
      );
      return {
        request,
        reused: false,
        preflight,
      };
    } catch (error) {
      const failure = this.classifyPreparationFailure(error);
      await this.requestService.markFailedRetryable(
        createResult.request.requestId,
        this.actorFrom(requester),
        failure.errorCode,
        'No se pudo completar la preparacion de la publicacion oficial',
        'PREPARING',
        new Date(),
        failure.errorStage,
      );
      throw error;
    }
  }

  private classifyPreparationFailure(error: unknown) {
    const response =
      error && typeof error === 'object' && 'getResponse' in error
        ? (error as any).getResponse?.()
        : null;
    const code =
      response && typeof response === 'object' && 'code' in response
        ? String((response as any).code)
        : error && typeof error === 'object' && 'code' in error
          ? String((error as any).code)
          : null;
    if (code === 'OFFICIAL_PUBLICATION_ARTIFACT_KEY_MISSING') {
      return {
        errorCode: code,
        errorStage: 'ARTIFACT_ENCRYPTION',
      };
    }
    return {
      errorCode: 'OFFICIAL_PUBLICATION_PREPARATION_FAILED',
      errorStage: 'PREPARATION',
    };
  }

  private assertCanPrepare(event: VotingEventDocument) {
    if (event.state !== 'READY_FOR_REVIEW') {
      throw new BadRequestException({
        code: 'OFFICIAL_PUBLICATION_INVALID_STATE',
        message: 'Solo se puede preparar publicacion oficial desde READY_FOR_REVIEW',
      });
    }
    if (!event.publishDeadline || new Date() >= new Date(event.publishDeadline)) {
      throw new BadRequestException({
        code: 'OFFICIAL_PUBLICATION_WINDOW_EXPIRED',
        message: 'La ventana de publicacion oficial vencio',
      });
    }
    if (!event.name?.trim()) {
      throw new BadRequestException({
        code: 'OFFICIAL_PUBLICATION_EMPTY_NAME',
        message: 'La votacion requiere nombre para publicar',
      });
    }
    if (!event.votingStart || !event.votingEnd || !event.resultsPublishAt) {
      throw new BadRequestException({
        code: 'OFFICIAL_PUBLICATION_INVALID_DATES',
        message: 'La votacion requiere fechas completas para publicar',
      });
    }
    if (!(event.votingStart < event.votingEnd && event.votingEnd <= event.resultsPublishAt)) {
      throw new BadRequestException({
        code: 'OFFICIAL_PUBLICATION_INVALID_DATES',
        message: 'Las fechas de votacion no son validas para publicar',
      });
    }
  }

  buildCanonicalCallDataHash(callData: { to: string; value: bigint | string; data: string }) {
    const data = callData.data.toLowerCase();
    if (!isHex(data)) {
      throw new BadRequestException({
        code: 'OFFICIAL_PUBLICATION_INVALID_CALLDATA',
        message: 'El calldata preparado no tiene formato hexadecimal valido',
      });
    }
    const value = typeof callData.value === 'bigint'
      ? callData.value
      : hexToBigInt(`0x${BigInt(callData.value).toString(16)}`);
    return keccak256(
      encodeAbiParameters(
        [
          { type: 'address', name: 'targetAddress' },
          { type: 'uint256', name: 'value' },
          { type: 'bytes32', name: 'callDataDigest' },
        ],
        [getAddress(callData.to), value, keccak256(data)],
      ),
    );
  }

  buildExecutionPackage(input: {
    chainId: number;
    smartAccountAddress: string;
    tokenAddress: string;
    spenderAddress: string;
    allowanceBefore: string;
    walletDebitRequired: string;
    createVoteCall: { to: string; value: bigint | string; data: string };
    approveRequired: boolean;
  }) {
    const calls: Array<{
      target: string;
      value: string;
      callData: string;
      purpose: 'TVD_APPROVAL' | 'CREATE_VOTE';
    }> = [];
    const walletDebitRequired = BigInt(input.walletDebitRequired);
    const allowanceBefore = BigInt(input.allowanceBefore);
    const approveRequired =
      input.approveRequired && walletDebitRequired > 0n && allowanceBefore < walletDebitRequired;
    if (approveRequired) {
      calls.push({
        target: getAddress(input.tokenAddress),
        value: '0',
        callData: encodeFunctionData({
          abi: TVD_TOKEN_ABI,
          functionName: 'approve',
          args: [getAddress(input.spenderAddress), walletDebitRequired],
        }),
        purpose: 'TVD_APPROVAL' as const,
      });
    }
    calls.push({
      target: getAddress(input.createVoteCall.to),
      value: String(input.createVoteCall.value),
      callData: input.createVoteCall.data,
      purpose: 'CREATE_VOTE' as const,
    });
    return {
      executionMode: calls.length > 1 ? 'BATCH' as const : 'SINGLE' as const,
      approveRequired,
      calls,
      callsHash: this.buildCanonicalCallsHash({
        chainId: input.chainId,
        smartAccountAddress: input.smartAccountAddress,
        calls,
      }),
    };
  }

  buildCanonicalCallsHash(input: {
    chainId: number;
    smartAccountAddress: string;
    calls: Array<{ target: string; value: string | bigint; callData: string }>;
  }) {
    return keccak256(
      encodeAbiParameters(
        [
          { type: 'uint256', name: 'chainId' },
          { type: 'address', name: 'smartAccountAddress' },
          {
            type: 'tuple[]',
            name: 'calls',
            components: [
              { type: 'address', name: 'target' },
              { type: 'uint256', name: 'value' },
              { type: 'bytes32', name: 'callDataDigest' },
            ],
          },
        ],
        [
          BigInt(input.chainId),
          getAddress(input.smartAccountAddress),
          input.calls.map((call) => {
            const data = call.callData.toLowerCase();
            if (!isHex(data)) {
              throw new BadRequestException({
                code: 'OFFICIAL_PUBLICATION_INVALID_CALLDATA',
                message: 'El calldata preparado no tiene formato hexadecimal valido',
              });
            }
            return {
              target: getAddress(call.target),
              value: typeof call.value === 'bigint' ? call.value : BigInt(call.value),
              callDataDigest: keccak256(data),
            };
          }),
        ],
      ),
    );
  }

  private hashJson(value: unknown) {
    return createHash('sha256')
      .update(JSON.stringify(value))
      .digest('hex');
  }

  private actorFrom(requester: any) {
    return requester?.sub ? String(requester.sub) : 'system';
  }
}
