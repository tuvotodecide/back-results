import { Types } from 'mongoose';
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
} from 'viem';
import voteContractAbi from '@/abi/voteContract.json';
import { TVD_ELECTORAL_CREDITS_ABI } from '@/modules/tvd/contracts/tvd-abis';
import { OfficialPublicationChainVerificationService } from '@/modules/institutional-voting/services/publication/official-publication-chain-verification.service';
import { entryPoint06Address } from 'viem/account-abstraction';

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

const TVD_TOKEN_ABI = [
  {
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

describe('OfficialPublicationChainVerificationService', () => {
  const smartAccountAddress = '0x1111111111111111111111111111111111111111';
  const voteProxyAddress = '0x7b57ee9103fc46ed6794329c36d2919293f0fabb';
  const creditsAddress = '0xbb4ea03105e2d883ab234d95f10dc7cc5000bb40';
  const tokenAddress = '0x0156d96babc74139a5cdb2cf2c90fda1f6b53562';
  let userOperationService: any;
  let service: OfficialPublicationChainVerificationService;

  beforeEach(() => {
    userOperationService = {
      getUserOperationByHash: jest.fn(),
      getUserOperationReceipt: jest.fn(),
      getBlockNumber: jest.fn().mockResolvedValue(105n),
    };
    service = new OfficialPublicationChainVerificationService(
      userOperationService,
      { get: jest.fn().mockReturnValue('2') } as any,
    );
  });

  it('confirma userOp con sender, EntryPoint, callData y VoteCreated correctos', async () => {
    const request = makeRequest();
    const callData = buildCreateVoteCallData();
    const userOperationCallData = encodeFunctionData({
      abi: COINBASE_SMART_ACCOUNT_ABI,
      functionName: 'execute',
      args: [voteProxyAddress, 0n, callData],
    });
    request.callData.data = callData;
    request.callDataHash = service.buildCanonicalCallDataHash({
      to: voteProxyAddress,
      value: 0n,
      data: callData,
    });

    userOperationService.getUserOperationByHash.mockResolvedValue({
      entryPoint: entryPoint06Address,
      userOperation: {
        sender: smartAccountAddress,
        callData: userOperationCallData,
      },
    });
    userOperationService.getUserOperationReceipt.mockResolvedValue(
      makeReceipt({ success: true }),
    );

    const result = await service.verifySubmittedRequest(request as any);

    expect(result).toMatchObject({
      status: 'CONFIRMED',
      txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      confirmations: 6,
    });
  });

  it('confirma batch approve + createVote con spender, monto, orden y hash correctos', async () => {
    const request: any = makeRequest({
      executionMode: 'BATCH',
      approveRequired: true,
      allowanceBefore: '0',
      walletDebitRequired: '2000000000000000000',
      executionPackageVersion: 2,
    });
    const createVoteCallData = buildCreateVoteCallData();
    const approveCallData = encodeFunctionData({
      abi: TVD_TOKEN_ABI,
      functionName: 'approve',
      args: [creditsAddress, 2000000000000000000n],
    });
    request.callData.data = createVoteCallData;
    request.executionCalls = [
      {
        target: tokenAddress,
        value: '0',
        callData: approveCallData,
        purpose: 'TVD_APPROVAL',
      },
      {
        target: voteProxyAddress,
        value: '0',
        callData: createVoteCallData,
        purpose: 'CREATE_VOTE',
      },
    ];
    request.callsHash = service.buildCanonicalCallsHash(
      request.chainId,
      smartAccountAddress,
      request.executionCalls.map((call: any) => ({
        to: call.target,
        value: call.value,
        data: call.callData,
      })),
    );

    const userOperationCallData = encodeFunctionData({
      abi: COINBASE_SMART_ACCOUNT_ABI,
      functionName: 'executeBatch',
      args: [
        request.executionCalls.map((call: any) => ({
          target: call.target,
          value: BigInt(call.value),
          data: call.callData,
        })),
      ],
    });

    userOperationService.getUserOperationByHash.mockResolvedValue({
      entryPoint: entryPoint06Address,
      userOperation: {
        sender: smartAccountAddress,
        callData: userOperationCallData,
      },
    });
    userOperationService.getUserOperationReceipt.mockResolvedValue(
      makeReceipt({ success: true }),
    );

    const result = await service.verifySubmittedRequest(request as any);

    expect(result).toMatchObject({
      status: 'CONFIRMED',
      txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
  });

  it('mantiene pendiente cuando no existe receipt de UserOperation', async () => {
    userOperationService.getUserOperationByHash.mockResolvedValue(null);
    userOperationService.getUserOperationReceipt.mockResolvedValue(null);

    const result = await service.verifySubmittedRequest(makeRequest() as any);

    expect(result).toMatchObject({
      status: 'PENDING',
      code: 'OFFICIAL_PUBLICATION_USER_OPERATION_PENDING',
    });
  });

  it('rechaza sender distinto como NEEDS_REVIEW/MISMATCH', async () => {
    userOperationService.getUserOperationByHash.mockResolvedValue({
      entryPoint: entryPoint06Address,
      userOperation: {
        sender: '0x9999999999999999999999999999999999999999',
        callData: '0x1234',
      },
    });
    userOperationService.getUserOperationReceipt.mockResolvedValue(
      makeReceipt({ success: true }),
    );

    const result = await service.verifySubmittedRequest(makeRequest() as any);

    expect(result).toMatchObject({
      status: 'MISMATCH',
      code: 'OFFICIAL_PUBLICATION_SENDER_MISMATCH',
    });
  });

  it('detecta txHash movil incompatible con receipt autoritativo', async () => {
    userOperationService.getUserOperationByHash.mockResolvedValue({
      entryPoint: entryPoint06Address,
      userOperation: {
        sender: smartAccountAddress,
        callData: '0x1234',
      },
    });
    userOperationService.getUserOperationReceipt.mockResolvedValue(
      makeReceipt({ success: true }),
    );

    const result = await service.verifySubmittedRequest(
      makeRequest({
        txHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      }) as any,
    );

    expect(result).toMatchObject({
      status: 'MISMATCH',
      code: 'OFFICIAL_PUBLICATION_TX_HASH_MISMATCH',
    });
  });

  it('clasifica receipt revertido como fallo final', async () => {
    userOperationService.getUserOperationByHash.mockResolvedValue({
      entryPoint: entryPoint06Address,
      userOperation: {
        sender: smartAccountAddress,
        callData: '0x1234',
      },
    });
    userOperationService.getUserOperationReceipt.mockResolvedValue(
      makeReceipt({ success: false, status: '0x0' }),
    );

    const result = await service.verifySubmittedRequest(makeRequest() as any);

    expect(result).toMatchObject({
      status: 'REVERTED',
      code: 'OFFICIAL_PUBLICATION_USER_OPERATION_REVERTED',
    });
  });

  it('BR-N11 rechaza EntryPoint incorrecto sin finalizar', async () => {
    const { request, lookup } = makeConfirmedSingleCallEvidence();
    userOperationService.getUserOperationByHash.mockResolvedValue({
      ...lookup,
      entryPoint: '0x2222222222222222222222222222222222222222',
    });
    userOperationService.getUserOperationReceipt.mockResolvedValue(
      makeReceipt({ success: true }),
    );

    const result = await service.verifySubmittedRequest(request as any);

    expect(result).toMatchObject({
      status: 'MISMATCH',
      code: 'OFFICIAL_PUBLICATION_ENTRY_POINT_MISMATCH',
    });
  });

  it('BR-N13 rechaza target distinto al contrato preparado', async () => {
    const { request } = makeConfirmedSingleCallEvidence();
    const userOperationCallData = encodeFunctionData({
      abi: COINBASE_SMART_ACCOUNT_ABI,
      functionName: 'execute',
      args: [
        '0x2222222222222222222222222222222222222222',
        0n,
        request.callData.data,
      ],
    });
    userOperationService.getUserOperationByHash.mockResolvedValue({
      entryPoint: entryPoint06Address,
      userOperation: {
        sender: smartAccountAddress,
        callData: userOperationCallData,
      },
    });
    userOperationService.getUserOperationReceipt.mockResolvedValue(
      makeReceipt({ success: true }),
    );

    const result = await service.verifySubmittedRequest(request as any);

    expect(result).toMatchObject({
      status: 'MISMATCH',
      code: 'OFFICIAL_PUBLICATION_TARGET_MISMATCH',
    });
  });

  it('BR-N15 rechaza receipt sin evento VoteCreated esperado', async () => {
    const { request, lookup } = makeConfirmedSingleCallEvidence();
    userOperationService.getUserOperationByHash.mockResolvedValue(lookup);
    userOperationService.getUserOperationReceipt.mockResolvedValue({
      ...makeReceipt({ success: true }),
      receipt: {
        ...makeReceipt({ success: true }).receipt,
        logs: [],
      },
    });

    const result = await service.verifySubmittedRequest(request as any);

    expect(result).toMatchObject({
      status: 'MISMATCH',
      code: 'OFFICIAL_PUBLICATION_VOTE_CREATED_EVENT_MISSING',
    });
  });

  it('BR-N16 rechaza evidencia de TVD con monto distinto al snapshot', async () => {
    const { request, lookup } = makeConfirmedSingleCallEvidence();
    userOperationService.getUserOperationByHash.mockResolvedValue(lookup);
    userOperationService.getUserOperationReceipt.mockResolvedValue({
      ...makeReceipt({ success: true }),
      receipt: {
        ...makeReceipt({ success: true }).receipt,
        logs: [
          ...makeReceipt({ success: true }).receipt.logs,
          makeCreditsTopUpLog({ creditsPurchased: 99n, tvdLocked: 2000000000000000000n }),
        ],
      },
    });

    const result = await service.verifySubmittedRequest(request as any);

    expect(result).toMatchObject({
      status: 'MISMATCH',
      code: 'OFFICIAL_PUBLICATION_CREDITS_AMOUNT_MISMATCH',
    });
  });

  it('BR-N17 clasifica error transitorio RPC como retryable sin fallo final', async () => {
    const { request, lookup } = makeConfirmedSingleCallEvidence();
    userOperationService.getUserOperationByHash.mockResolvedValue(lookup);
    userOperationService.getUserOperationReceipt.mockResolvedValue(
      makeReceipt({ success: true }),
    );
    userOperationService.getBlockNumber.mockRejectedValueOnce(
      new Error('RPC temporalmente no disponible'),
    );

    const result = await service.verifySubmittedRequest(request as any);

    expect(result).toMatchObject({
      status: 'RETRYABLE_ERROR',
      code: 'OFFICIAL_PUBLICATION_CHAIN_VERIFICATION_RETRYABLE',
    });
  });

  function makeRequest(overrides: Record<string, unknown> = {}) {
    return {
      _id: new Types.ObjectId(),
      requestId: 'request-1',
      userOpHash: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      txHash: null,
      chainId: 84532,
      smartAccountAddress,
      entryPointAddress: entryPoint06Address,
      callData: {
        to: voteProxyAddress,
        value: '0',
        data: buildCreateVoteCallData(),
      },
      callDataHash: '0x00',
      proxyAddress: voteProxyAddress,
      spender: creditsAddress,
      onChainElectionId: '123',
      institutionId: 'institution-1',
      enabledVotersCount: 2,
      merkleRoots: {
        ciMerkleRoot: '111',
      },
      creditsRequired: '2',
      tvdRequired: '2000000000000000000',
      ...overrides,
    };
  }

  function makeConfirmedSingleCallEvidence() {
    const request = makeRequest();
    const callData = buildCreateVoteCallData();
    const userOperationCallData = encodeFunctionData({
      abi: COINBASE_SMART_ACCOUNT_ABI,
      functionName: 'execute',
      args: [voteProxyAddress, 0n, callData],
    });
    request.callData.data = callData;
    request.callDataHash = service.buildCanonicalCallDataHash({
      to: voteProxyAddress,
      value: 0n,
      data: callData,
    });
    return {
      request,
      lookup: {
        entryPoint: entryPoint06Address,
        userOperation: {
          sender: smartAccountAddress,
          callData: userOperationCallData,
        },
      },
    };
  }

  function makeCreditsTopUpLog(input: {
    creditsPurchased: bigint;
    tvdLocked: bigint;
    electionId?: bigint;
  }) {
    return {
      address: creditsAddress,
      topics: encodeEventTopics({
        abi: TVD_ELECTORAL_CREDITS_ABI,
        eventName: 'TopUp',
        args: { institution: smartAccountAddress },
      }),
      data: encodeAbiParameters(
        [
          { type: 'uint256' },
          { type: 'uint256' },
          { type: 'uint256' },
        ],
        [input.electionId ?? 123n, input.creditsPurchased, input.tvdLocked],
      ),
    };
  }

  function buildCreateVoteCallData() {
    return encodeFunctionData({
      abi: voteContractAbi,
      functionName: 'createVote',
      args: [
        123n,
        'institution-1',
        'Eleccion',
        1,
        2,
        3,
        2,
        111n,
        ['A', 'B', 'BLANK'],
      ],
    });
  }

  function makeReceipt(input: { success: boolean; status?: string }) {
    return {
      userOpHash: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      sender: smartAccountAddress,
      entryPoint: entryPoint06Address,
      success: input.success,
      txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      receipt: {
        transactionHash:
          '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        status: input.status ?? '0x1',
        blockNumber: 100n,
        logs: [
          {
            address: voteProxyAddress,
            topics: encodeEventTopics({
              abi: voteContractAbi,
              eventName: 'VoteCreated',
              args: { id: 123n },
            }),
            data: encodeAbiParameters([{ type: 'string' }], ['Eleccion']),
          },
        ],
      },
    };
  }
});
