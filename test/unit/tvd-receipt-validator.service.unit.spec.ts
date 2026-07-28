import { TVD_ASSIGNMENT_ABI } from '@/modules/tvd/contracts/tvd-abis';
import { TvdBlockchainError } from '@/modules/tvd/errors/tvd-blockchain.error';
import { TvdReceiptValidatorService } from '@/modules/tvd/services/tvd-receipt-validator.service';
import { encodeAbiParameters, encodeEventTopics, getAddress } from 'viem';

const CASE_TYPE_POSITIVE = 'POSITIVO';
const CASE_TYPE_NEGATIVE = 'NEGATIVO';
const LEVEL_UNIT = 'UNITARIO';

const assignment = getAddress('0x2222222222222222222222222222222222222222');
const entryPoint = getAddress('0x0000000071727De22E5E9d8BAf0edAc6f37da032');
const bundlerRelayer = getAddress('0x3333333333333333333333333333333333333333');
const institution = getAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
const otherInstitution = getAddress('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');

function tokensAssignedLog(address = assignment, wallet = institution, amount = '1000') {
  return {
    address,
    topics: encodeEventTopics({
      abi: TVD_ASSIGNMENT_ABI,
      eventName: 'TokensAssigned',
      args: { institution: wallet },
    }),
    data: encodeAbiParameters([{ type: 'uint256' }], [BigInt(amount)]),
  };
}

function receipt(overrides: Record<string, any> = {}) {
  return {
    transactionHash: '0x' + '1'.repeat(64),
    status: 'success',
    to: entryPoint,
    from: bundlerRelayer,
    blockNumber: 100n,
    logs: [tokensAssignedLog()],
    ...overrides,
  };
}

function validate(overrides: Record<string, any> = {}) {
  const { receipt: receiptOverride, ...rest } = overrides;
  return new TvdReceiptValidatorService().validateAssignReceipt({
    receipt: receiptOverride === null ? null : receipt(receiptOverride ?? {}),
    expectedChainId: 84532,
    actualChainId: 84532,
    expectedContractAddress: assignment,
    expectedEntryPointAddress: entryPoint,
    expectedInstitutionWallet: institution,
    expectedAmountSmallestUnit: '1000',
    confirmationsRequired: 3,
    currentBlockNumber: 105n,
    ...rest,
  });
}

describe('TVD receipt validator service', () => {
  describe('POSITIVOS', () => {
    it('P-UNIT-014/P-UNIT-015/P-UNIT-016 | POSITIVO | UNITARIO | valida receipt exitoso y TokensAssigned', () => {
      const result = validate();

      expect(result).toEqual({
        txHash: '0x' + '1'.repeat(64),
        blockNumber: '100',
        confirmations: 6,
      });
    });
  });

  describe('NEGATIVOS', () => {
    it.each([
      [
        'N-UNIT-017',
        'receipt con status fallido',
        { receipt: { status: 'reverted' } },
        'TVD_RECEIPT_FAILED',
      ],
      [
        'N-UNIT-018',
        'evento ausente',
        { receipt: { logs: [] } },
        'TVD_EVENT_NOT_FOUND',
      ],
      [
        'N-UNIT-019',
        'evento emitido por otro contrato',
        {
          receipt: {
            logs: [tokensAssignedLog('0x4444444444444444444444444444444444444444')],
          },
        },
        'TVD_EVENT_NOT_FOUND',
      ],
      [
        'N-UNIT-020',
        'wallet del evento distinta',
        { receipt: { logs: [tokensAssignedLog(assignment, otherInstitution)] } },
        'TVD_EVENT_WALLET_MISMATCH',
      ],
      [
        'N-UNIT-021',
        'monto del evento distinto',
        { receipt: { logs: [tokensAssignedLog(assignment, institution, '999')] } },
        'TVD_EVENT_AMOUNT_MISMATCH',
      ],
      [
        'N-UNIT-022',
        'receipt.to distinto del EntryPoint (no es una transaccion AA)',
        { receipt: { to: assignment } },
        'TVD_RECEIPT_CONTRACT_MISMATCH',
      ],
      [
        'N-UNIT-023',
        'confirmaciones insuficientes',
        { currentBlockNumber: 101n },
        'TVD_CONFIRMATIONS_INSUFFICIENT',
      ],
    ])('%s | NEGATIVO | UNITARIO | %s', (_id, _scenario, override, code) => {
      expect(() => validate(override as any)).toThrow(
        expect.objectContaining({ code }),
      );
    });

    it('N-UNIT-016 | NEGATIVO | UNITARIO | receipt inexistente', () => {
      expect(() => validate({ receipt: null })).toThrow(
        expect.objectContaining({ code: 'TVD_RECEIPT_NOT_FOUND' }),
      );
    });
  });

  it('documenta metadata minima de casos', () => {
    expect({
      type: CASE_TYPE_POSITIVE,
      level: LEVEL_UNIT,
      negativeType: CASE_TYPE_NEGATIVE,
    }).toEqual(
      expect.objectContaining({
        type: 'POSITIVO',
        level: 'UNITARIO',
        negativeType: 'NEGATIVO',
      }),
    );
  });
});
