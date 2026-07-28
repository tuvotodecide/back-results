import { Injectable } from '@nestjs/common';
import { Address, decodeEventLog, getAddress, Hex } from 'viem';
import { TVD_ASSIGNMENT_ABI } from '../contracts/tvd-abis';
import { TvdBlockchainError } from '../errors/tvd-blockchain.error';

export type ValidateTvdAssignReceiptInput = {
  receipt: any;
  expectedChainId: number;
  actualChainId: number;
  expectedContractAddress: Address;
  expectedEntryPointAddress: Address;
  expectedInstitutionWallet: Address;
  expectedAmountSmallestUnit: string;
  confirmationsRequired: number;
  currentBlockNumber: bigint;
};

export type ValidateTvdAssignReceiptResult = {
  txHash: Hex;
  blockNumber: string;
  confirmations: number;
};

@Injectable()
export class TvdReceiptValidatorService {
  validateAssignReceipt(
    input: ValidateTvdAssignReceiptInput,
  ): ValidateTvdAssignReceiptResult {
    const receipt = input.receipt;
    if (!receipt) {
      throw new TvdBlockchainError('TVD_RECEIPT_NOT_FOUND');
    }

    if (input.actualChainId !== input.expectedChainId) {
      throw new TvdBlockchainError('TVD_CHAIN_MISMATCH');
    }

    if (String(receipt.status).toLowerCase() !== 'success') {
      throw new TvdBlockchainError('TVD_RECEIPT_FAILED');
    }

    // The assignment is submitted via an ERC-4337 bundler, so the top-level transaction
    // calls the EntryPoint (not the assignment contract) and is sent from the bundler's
    // relayer (not the operator). That the operator actually invoked `assign()` is proven
    // below by the TokensAssigned event emitted by expectedContractAddress, which the
    // contract only allows for callers holding OPERATOR_ROLE.
    if (
      receipt.to &&
      getAddress(receipt.to) !== getAddress(input.expectedEntryPointAddress)
    ) {
      throw new TvdBlockchainError('TVD_RECEIPT_CONTRACT_MISMATCH');
    }

    const blockNumber = BigInt(receipt.blockNumber ?? 0);
    const confirmations =
      blockNumber > 0n && input.currentBlockNumber >= blockNumber
        ? Number(input.currentBlockNumber - blockNumber + 1n)
        : 0;

    if (confirmations < input.confirmationsRequired) {
      throw new TvdBlockchainError('TVD_CONFIRMATIONS_INSUFFICIENT');
    }

    const event = this.findTokensAssignedEvent(
      receipt.logs ?? [],
      input.expectedContractAddress,
    );

    if (!event) {
      throw new TvdBlockchainError('TVD_EVENT_NOT_FOUND');
    }

    if (
      getAddress(event.institution) !== getAddress(input.expectedInstitutionWallet)
    ) {
      throw new TvdBlockchainError('TVD_EVENT_WALLET_MISMATCH');
    }

    if (event.amount.toString() !== input.expectedAmountSmallestUnit) {
      throw new TvdBlockchainError('TVD_EVENT_AMOUNT_MISMATCH');
    }

    return {
      txHash: receipt.transactionHash,
      blockNumber: blockNumber.toString(),
      confirmations,
    };
  }

  private findTokensAssignedEvent(logs: any[], expectedContractAddress: Address) {
    for (const log of logs) {
      if (!log?.address) continue;
      if (getAddress(log.address) !== getAddress(expectedContractAddress)) {
        continue;
      }

      try {
        const decoded = decodeEventLog({
          abi: TVD_ASSIGNMENT_ABI,
          eventName: 'TokensAssigned',
          data: log.data,
          topics: log.topics,
        }) as any;

        return {
          institution: decoded.args.institution as Address,
          amount: decoded.args.amount as bigint,
        };
      } catch {
        continue;
      }
    }

    return null;
  }
}
