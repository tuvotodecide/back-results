import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  decodeEventLog,
  decodeFunctionData,
  encodeAbiParameters,
  getAddress,
  isAddress,
  isHex,
  keccak256,
} from 'viem';
import { entryPoint06Address } from 'viem/account-abstraction';
import voteContractAbi from '@/abi/voteContract.json';
import { TVD_ELECTORAL_CREDITS_ABI, TVD_TOKEN_ABI } from '@/modules/tvd/contracts/tvd-abis';
import { OfficialPublicationRequestDocument } from '../../schemas/official-publication-request.schema';
import {
  OfficialPublicationUserOperationLookup,
  OfficialPublicationUserOperationReceipt,
  OfficialPublicationUserOperationService,
} from './official-publication-user-operation.service';

export type OfficialPublicationVerificationResult =
  | { status: 'PENDING'; code: string; nextRetryAt?: Date; retryCount?: number }
  | {
      status: 'CONFIRMED';
      txHash: string;
      receiptBlockNumber: bigint;
      confirmedBlockNumber: bigint;
      confirmations: number;
    }
  | { status: 'REVERTED'; code: string; safeMessage: string }
  | { status: 'MISMATCH'; code: string; safeMessage: string }
  | { status: 'RETRYABLE_ERROR'; code: string; safeMessage: string; nextRetryAt: Date };

type ExecutedCall = {
  to: string;
  value: bigint;
  data: string;
};

const COINBASE_SMART_ACCOUNT_ABI = [
  {
    inputs: [
      { name: 'target', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    name: 'execute',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          { name: 'target', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' },
        ],
        name: 'calls',
        type: 'tuple[]',
      },
    ],
    name: 'executeBatch',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
] as const;

const SIMPLE_ACCOUNT_ABI = [
  {
    inputs: [
      { name: 'dest', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'func', type: 'bytes' },
    ],
    name: 'execute',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'dest', type: 'address[]' },
      { name: 'value', type: 'uint256[]' },
      { name: 'func', type: 'bytes[]' },
    ],
    name: 'executeBatch',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

@Injectable()
export class OfficialPublicationChainVerificationService {
  private readonly requiredConfirmations: number;

  constructor(
    private readonly userOperationService: OfficialPublicationUserOperationService,
    private readonly configService: ConfigService,
  ) {
    this.requiredConfirmations = Math.max(
      0,
      Number(
        this.configService.get<string>(
          'app.officialPublication.requiredConfirmations',
        ) || '1',
      ),
    );
  }

  async verifySubmittedRequest(
    request: OfficialPublicationRequestDocument,
  ): Promise<OfficialPublicationVerificationResult> {
    try {
      if (!request.userOpHash || !isHex(request.userOpHash, { strict: true })) {
        return this.mismatch(
          'OFFICIAL_PUBLICATION_USER_OP_HASH_INVALID',
          'La operacion registrada no tiene formato valido',
        );
      }

      const [lookup, userOpReceipt] = await Promise.all([
        this.userOperationService.getUserOperationByHash(request.userOpHash),
        this.userOperationService.getUserOperationReceipt(request.userOpHash),
      ]);

      if (!userOpReceipt) {
        return {
          status: 'PENDING',
          code: 'OFFICIAL_PUBLICATION_USER_OPERATION_PENDING',
        };
      }

      const identityResult = this.verifyUserOperationIdentity(request, lookup, userOpReceipt);
      if (identityResult) return identityResult;

      if (!this.isReceiptSuccessful(userOpReceipt)) {
        return {
          status: 'REVERTED',
          code: 'OFFICIAL_PUBLICATION_USER_OPERATION_REVERTED',
          safeMessage: 'La operacion fue revertida en blockchain',
        };
      }

      if (!lookup?.userOperation?.callData) {
        return this.mismatch(
          'OFFICIAL_PUBLICATION_USER_OPERATION_CALLDATA_MISSING',
          'No se pudo verificar el contenido ejecutado por la smart account',
        );
      }

      const executionResult = this.verifySmartAccountExecution(request, lookup);
      if (executionResult) return executionResult;

      const voteEventResult = this.verifyVoteCreatedEvent(request, userOpReceipt);
      if (voteEventResult) return voteEventResult;

      const creditsEventResult = this.verifyCreditsEvents(request, userOpReceipt);
      if (creditsEventResult) return creditsEventResult;

      const receiptBlockNumber = BigInt(userOpReceipt.receipt.blockNumber);
      const currentBlock = await this.userOperationService.getBlockNumber();
      if (currentBlock < receiptBlockNumber) {
        return {
          status: 'PENDING',
          code: 'OFFICIAL_PUBLICATION_BLOCK_NUMBER_INCONSISTENT',
        };
      }
      const confirmations = Number(currentBlock - receiptBlockNumber + 1n);
      if (confirmations < this.requiredConfirmations) {
        return {
          status: 'PENDING',
          code: 'OFFICIAL_PUBLICATION_CONFIRMATIONS_PENDING',
        };
      }

      return {
        status: 'CONFIRMED',
        txHash: userOpReceipt.receipt.transactionHash.toLowerCase(),
        receiptBlockNumber,
        confirmedBlockNumber: currentBlock,
        confirmations,
      };
    } catch {
      return {
        status: 'RETRYABLE_ERROR',
        code: 'OFFICIAL_PUBLICATION_CHAIN_VERIFICATION_RETRYABLE',
        safeMessage: 'No se pudo verificar temporalmente la operacion',
        nextRetryAt: new Date(Date.now() + 30_000),
      };
    }
  }

  verifyUserOperationIdentity(
    request: OfficialPublicationRequestDocument,
    lookup: OfficialPublicationUserOperationLookup | null,
    receipt: OfficialPublicationUserOperationReceipt,
  ): OfficialPublicationVerificationResult | null {
    const sender = lookup?.userOperation?.sender || receipt.sender;
    if (!sender || !this.sameAddress(sender, request.smartAccountAddress)) {
      return this.mismatch(
        'OFFICIAL_PUBLICATION_SENDER_MISMATCH',
        'La operacion no fue enviada por la smart account esperada',
      );
    }

    const expectedEntryPoint =
      request.entryPointAddress || request.entryPoint || entryPoint06Address;
    const entryPoint = lookup?.entryPoint || receipt.entryPoint;
    if (entryPoint && !this.sameAddress(entryPoint, expectedEntryPoint)) {
      return this.mismatch(
        'OFFICIAL_PUBLICATION_ENTRY_POINT_MISMATCH',
        'La operacion no usa el EntryPoint esperado',
      );
    }

    const txHash = receipt.receipt?.transactionHash?.toLowerCase();
    if (!txHash) {
      return this.mismatch(
        'OFFICIAL_PUBLICATION_RECEIPT_TX_HASH_MISSING',
        'El receipt no contiene hash de transaccion',
      );
    }
    if (request.txHash && request.txHash.toLowerCase() !== txHash) {
      return this.mismatch(
        'OFFICIAL_PUBLICATION_TX_HASH_MISMATCH',
        'El hash de transaccion no coincide con la evidencia autoritativa',
      );
    }

    return null;
  }

  verifySmartAccountExecution(
    request: OfficialPublicationRequestDocument,
    lookup: OfficialPublicationUserOperationLookup,
  ): OfficialPublicationVerificationResult | null {
    const calls = this.decodeSmartAccountCalls(lookup.userOperation.callData);
    const expectedCalls = request.executionCalls?.length
      ? request.executionCalls.map((call) => ({
          to: call.target,
          value: BigInt(call.value),
          data: call.callData,
          purpose: call.purpose,
        }))
      : [{
          to: request.callData.to,
          value: BigInt(request.callData.value),
          data: request.callData.data,
          purpose: 'CREATE_VOTE',
        }];
    if (!calls || calls.length !== expectedCalls.length) {
      return this.mismatch(
        'OFFICIAL_PUBLICATION_SMART_ACCOUNT_CALL_UNSUPPORTED',
        'No se pudo verificar el paquete preparado',
      );
    }
    for (let i = 0; i < expectedCalls.length; i += 1) {
      const call = calls[i];
      const expected = expectedCalls[i];
      if (!this.sameAddress(call.to, expected.to)) {
        return this.mismatch(
          'OFFICIAL_PUBLICATION_TARGET_MISMATCH',
          'La operacion no apunta al contrato esperado',
        );
      }
      if (call.value !== expected.value) {
        return this.mismatch(
          'OFFICIAL_PUBLICATION_VALUE_MISMATCH',
          'La operacion usa un valor nativo distinto al preparado',
        );
      }
      if (call.data.toLowerCase() !== expected.data.toLowerCase()) {
        return this.mismatch(
          'OFFICIAL_PUBLICATION_CALLDATA_MISMATCH',
          'La operacion no coincide con el calldata preparado',
        );
      }
    }
    const expectedHash = request.callsHash ?? request.callDataHash;
    const calculatedHash = request.callsHash
      ? this.buildCanonicalCallsHash(request.chainId, request.smartAccountAddress, calls)
      : this.buildCanonicalCallDataHash(calls[calls.length - 1]);
    if (calculatedHash !== expectedHash) {
      return this.mismatch(
        'OFFICIAL_PUBLICATION_CALLDATA_HASH_MISMATCH',
        'El hash canonico del calldata no coincide',
      );
    }

    if (expectedCalls.length === 2) {
      if (expectedCalls[0].purpose !== 'TVD_APPROVAL' || expectedCalls[1].purpose !== 'CREATE_VOTE') {
        return this.mismatch(
          'OFFICIAL_PUBLICATION_BATCH_ORDER_MISMATCH',
          'El paquete no respeta el orden approve y createVote',
        );
      }
      const approveResult = this.verifyApprovalCall(calls[0], request);
      if (approveResult) return approveResult;
    }
    const createVoteCall = calls[calls.length - 1];
    const voteCall = decodeFunctionData({
      abi: voteContractAbi,
      data: createVoteCall.data as `0x${string}`,
    });
    if (voteCall.functionName !== 'createVote') {
      return this.mismatch(
        'OFFICIAL_PUBLICATION_CREATE_VOTE_SELECTOR_MISMATCH',
        'La operacion no ejecuta createVote',
      );
    }
    const args = voteCall.args as readonly unknown[];
    if (String(args[0]) !== String(request.onChainElectionId)) {
      return this.mismatch(
        'OFFICIAL_PUBLICATION_ELECTION_ID_MISMATCH',
        'La operacion contiene otra votacion',
      );
    }
    if (String(args[1]) !== request.institutionId) {
      return this.mismatch(
        'OFFICIAL_PUBLICATION_INSTITUTION_MISMATCH',
        'La operacion contiene otra institucion',
      );
    }
    if (Number(args[6]) !== request.enabledVotersCount) {
      return this.mismatch(
        'OFFICIAL_PUBLICATION_VOTERS_COUNT_MISMATCH',
        'La operacion contiene otra cantidad de votantes',
      );
    }
    if (String(args[7]) !== request.merkleRoots.ciMerkleRoot) {
      return this.mismatch(
        'OFFICIAL_PUBLICATION_ENABLED_ROOT_MISMATCH',
        'La raiz de votantes habilitados no coincide',
      );
    }
    return null;
  }

  private verifyApprovalCall(
    call: ExecutedCall,
    request: OfficialPublicationRequestDocument,
  ): OfficialPublicationVerificationResult | null {
    let decoded: any;
    try {
      decoded = decodeFunctionData({
        abi: TVD_TOKEN_ABI,
        data: call.data as `0x${string}`,
      });
    } catch {
      return this.mismatch(
        'OFFICIAL_PUBLICATION_APPROVAL_CALL_INVALID',
        'La aprobacion TVD no pudo decodificarse',
      );
    }
    if (decoded.functionName !== 'approve') {
      return this.mismatch(
        'OFFICIAL_PUBLICATION_APPROVAL_SELECTOR_MISMATCH',
        'La primera llamada no autoriza TVD',
      );
    }
    const [spender, amount] = decoded.args as readonly unknown[];
    if (!this.sameAddress(String(spender), request.spender)) {
      return this.mismatch(
        'OFFICIAL_PUBLICATION_APPROVAL_SPENDER_MISMATCH',
        'El spender TVD no coincide',
      );
    }
    if (String(amount) !== String(request.walletDebitRequired ?? '0')) {
      return this.mismatch(
        'OFFICIAL_PUBLICATION_APPROVAL_AMOUNT_MISMATCH',
        'El monto TVD autorizado no coincide',
      );
    }
    return null;
  }

  verifyVoteCreatedEvent(
    request: OfficialPublicationRequestDocument,
    receipt: OfficialPublicationUserOperationReceipt,
  ): OfficialPublicationVerificationResult | null {
    for (const log of receipt.receipt.logs || []) {
      if (!this.sameAddress(log.address, request.proxyAddress)) continue;
      try {
        const decoded = decodeEventLog({
          abi: voteContractAbi,
          data: log.data as `0x${string}`,
          topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
        });
        if (decoded.eventName !== 'VoteCreated') continue;
        const id = (decoded.args as any).id;
        if (String(id) === String(request.onChainElectionId)) {
          return null;
        }
        return this.mismatch(
          'OFFICIAL_PUBLICATION_VOTE_CREATED_EVENT_MISMATCH',
          'El evento VoteCreated pertenece a otra votacion',
        );
      } catch {
        continue;
      }
    }
    return this.mismatch(
      'OFFICIAL_PUBLICATION_VOTE_CREATED_EVENT_MISSING',
      'No se encontro el evento VoteCreated esperado',
    );
  }

  verifyCreditsEvents(
    request: OfficialPublicationRequestDocument,
    receipt: OfficialPublicationUserOperationReceipt,
  ): OfficialPublicationVerificationResult | null {
    const creditsAddress = request.spender;
    const knownCreditsLogs = (receipt.receipt.logs || []).filter((log) =>
      this.sameAddress(log.address, creditsAddress),
    );
    if (!knownCreditsLogs.length) {
      return null;
    }

    for (const log of knownCreditsLogs) {
      try {
        const decoded = decodeEventLog({
          abi: TVD_ELECTORAL_CREDITS_ABI,
          data: log.data as `0x${string}`,
          topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
        });
        const args = decoded.args as any;
        if (args.electionId !== undefined && String(args.electionId) !== request.onChainElectionId) {
          return this.mismatch(
            'OFFICIAL_PUBLICATION_CREDITS_ELECTION_MISMATCH',
            'La evidencia de creditos pertenece a otra votacion',
          );
        }
        if (
          args.creditsPurchased !== undefined &&
          String(args.creditsPurchased) !== request.creditsRequired
        ) {
          return this.mismatch(
            'OFFICIAL_PUBLICATION_CREDITS_AMOUNT_MISMATCH',
            'La evidencia de creditos no coincide con el snapshot',
          );
        }
        if (args.tvdLocked !== undefined && String(args.tvdLocked) !== request.tvdRequired) {
          return this.mismatch(
            'OFFICIAL_PUBLICATION_TVD_AMOUNT_MISMATCH',
            'La evidencia de TVD no coincide con el snapshot',
          );
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  decodeSmartAccountCalls(data: string): ExecutedCall[] | null {
    if (!isHex(data, { strict: true })) return null;
    try {
      const decoded = decodeFunctionData({
        abi: COINBASE_SMART_ACCOUNT_ABI,
        data: data as `0x${string}`,
      });
      if (decoded.functionName === 'execute') {
        return [
          {
            to: decoded.args[0],
            value: BigInt(decoded.args[1]),
            data: decoded.args[2],
          },
        ];
      }
      if (decoded.functionName === 'executeBatch') {
        return decoded.args[0].map((call: any) => ({
          to: call.target,
          value: BigInt(call.value),
          data: call.data,
        }));
      }
      return null;
    } catch {
      return this.decodeSimpleAccountCalls(data);
    }
  }

  private decodeSimpleAccountCalls(data: string): ExecutedCall[] | null {
    try {
      const decoded = decodeFunctionData({
        abi: SIMPLE_ACCOUNT_ABI,
        data: data as `0x${string}`,
      });
      if (decoded.functionName === 'execute') {
        return [
          {
            to: decoded.args[0],
            value: BigInt(decoded.args[1]),
            data: decoded.args[2],
          },
        ];
      }
      if (decoded.functionName === 'executeBatch') {
        const destinations = decoded.args[0];
        const values = decoded.args[1];
        const payloads = decoded.args[2];
        return destinations.map((to, index) => ({
          to,
          value: BigInt(values[index]),
          data: payloads[index],
        }));
      }
      return null;
    } catch {
      return null;
    }
  }

  buildCanonicalCallDataHash(callData: { to: string; value: bigint | string; data: string }) {
    const data = callData.data.toLowerCase();
    if (!isHex(data, { strict: true }) || !isAddress(callData.to)) {
      throw new Error('OFFICIAL_PUBLICATION_INVALID_CALLDATA');
    }
    const value = typeof callData.value === 'bigint'
      ? callData.value
      : BigInt(callData.value);
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

  buildCanonicalCallsHash(
    chainId: number,
    smartAccountAddress: string,
    calls: Array<{ to: string; value: bigint | string; data: string }>,
  ) {
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
          BigInt(chainId),
          getAddress(smartAccountAddress),
          calls.map((call) => ({
            target: getAddress(call.to),
            value: typeof call.value === 'bigint' ? call.value : BigInt(call.value),
            callDataDigest: keccak256(call.data as `0x${string}`),
          })),
        ],
      ),
    );
  }

  private isReceiptSuccessful(receipt: OfficialPublicationUserOperationReceipt) {
    if (!receipt.success) return false;
    const status = receipt.receipt?.status;
    return status === 'success' || status === '0x1' || status === 1 || status === 1n;
  }

  private sameAddress(a?: string | null, b?: string | null) {
    if (!a || !b || !isAddress(a) || !isAddress(b)) return false;
    return getAddress(a) === getAddress(b);
  }

  private mismatch(code: string, safeMessage: string): OfficialPublicationVerificationResult {
    return { status: 'MISMATCH', code, safeMessage };
  }
}
