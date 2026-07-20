import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';

export type TvdBlockchainErrorCode =
  | 'TVD_RPC_UNAVAILABLE'
  | 'TVD_CONFIG_INCOMPLETE'
  | 'TVD_CHAIN_MISMATCH'
  | 'TVD_OPERATOR_PRIVATE_KEY_INVALID'
  | 'TVD_OPERATOR_MISMATCH'
  | 'TVD_TOKEN_ADDRESS_MISMATCH'
  | 'TVD_DECIMALS_MISMATCH'
  | 'TVD_INVALID_WALLET'
  | 'TVD_INVALID_AMOUNT'
  | 'TVD_INSUFFICIENT_GAS'
  | 'TVD_INSUFFICIENT_CONTRACT_BALANCE'
  | 'TVD_ASSIGN_REVERTED'
  | 'TVD_RECEIPT_NOT_FOUND'
  | 'TVD_RECEIPT_FAILED'
  | 'TVD_RECEIPT_CONTRACT_MISMATCH'
  | 'TVD_RECEIPT_SENDER_MISMATCH'
  | 'TVD_EVENT_NOT_FOUND'
  | 'TVD_EVENT_WALLET_MISMATCH'
  | 'TVD_EVENT_AMOUNT_MISMATCH'
  | 'TVD_CONFIRMATIONS_INSUFFICIENT';

const messages: Record<TvdBlockchainErrorCode, string> = {
  TVD_RPC_UNAVAILABLE: 'Servicio blockchain TVD no disponible',
  TVD_CONFIG_INCOMPLETE: 'Configuracion blockchain TVD incompleta',
  TVD_CHAIN_MISMATCH: 'Red blockchain TVD incorrecta',
  TVD_OPERATOR_PRIVATE_KEY_INVALID: 'Configuracion blockchain TVD invalida',
  TVD_OPERATOR_MISMATCH: 'Operador TVD no autorizado',
  TVD_TOKEN_ADDRESS_MISMATCH: 'Token TVD configurado no coincide',
  TVD_DECIMALS_MISMATCH: 'Decimales TVD configurados no coinciden',
  TVD_INVALID_WALLET: 'Wallet TVD invalida',
  TVD_INVALID_AMOUNT: 'Monto TVD invalido',
  TVD_INSUFFICIENT_GAS: 'Gas insuficiente para operar TVD',
  TVD_INSUFFICIENT_CONTRACT_BALANCE: 'Saldo TVD insuficiente en contrato',
  TVD_ASSIGN_REVERTED: 'Asignacion TVD rechazada',
  TVD_RECEIPT_NOT_FOUND: 'Receipt TVD no encontrado',
  TVD_RECEIPT_FAILED: 'Transaccion TVD fallida',
  TVD_RECEIPT_CONTRACT_MISMATCH: 'Receipt TVD no corresponde al contrato',
  TVD_RECEIPT_SENDER_MISMATCH: 'Receipt TVD no corresponde al operador',
  TVD_EVENT_NOT_FOUND: 'Evento TVD requerido no encontrado',
  TVD_EVENT_WALLET_MISMATCH: 'Wallet del evento TVD no coincide',
  TVD_EVENT_AMOUNT_MISMATCH: 'Monto del evento TVD no coincide',
  TVD_CONFIRMATIONS_INSUFFICIENT: 'Confirmaciones TVD insuficientes',
};

export class TvdBlockchainError extends Error {
  constructor(
    readonly code: TvdBlockchainErrorCode,
    _cause?: unknown,
  ) {
    super(messages[code]);
  }

  toHttpException() {
    if (
      this.code === 'TVD_RPC_UNAVAILABLE' ||
      this.code === 'TVD_ASSIGN_REVERTED'
    ) {
      return new ServiceUnavailableException({
        code: this.code,
        message: this.message,
      });
    }

    return new BadRequestException({
      code: this.code,
      message: this.message,
    });
  }
}
