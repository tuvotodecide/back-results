import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';

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
  | 'TVD_CREDITS_CONFIG_INCOMPLETE'
  | 'TVD_CREDITS_TOKEN_MISMATCH'
  | 'TVD_CREDITS_SPENDER_INVALID'
  | 'TVD_CREDITS_OPERATOR_NOT_AUTHORIZED'
  | 'TVD_CREDITS_INSUFFICIENT_CAPACITY'
  | 'TVD_CREDITS_BALANCE_INSUFFICIENT'
  | 'TVD_BALANCE_TEMPORARILY_UNAVAILABLE'
  | 'TVD_CREDITS_MAX_TOKEN_INVALID'
  | 'TVD_CREDITS_MAX_TOKEN_EXCEEDED'
  | 'TVD_CREDITS_SOURCE_CONFIG_MISMATCH'
  | 'TVD_ALLOWANCE_INSUFFICIENT'
  | 'TVD_VOTE_MANAGER_CONFIG_INCOMPLETE'
  | 'TVD_VOTE_MANAGER_IMPLEMENTATION_MISMATCH'
  | 'TVD_INSTITUTION_NOT_REGISTERED'
  | 'TVD_WALLET_NOT_AUTHORIZED'
  | 'TVD_VOTE_ALREADY_EXISTS'
  | 'TVD_CREATE_VOTE_PREFLIGHT_REVERTED'
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
  TVD_CREDITS_CONFIG_INCOMPLETE: 'Configuracion de creditos electorales incompleta',
  TVD_CREDITS_TOKEN_MISMATCH: 'Token TVD configurado no coincide con creditos',
  TVD_CREDITS_SPENDER_INVALID: 'Spender TVD configurado invalido',
  TVD_CREDITS_OPERATOR_NOT_AUTHORIZED: 'Contrato de votacion no autorizado para creditos TVD',
  TVD_CREDITS_INSUFFICIENT_CAPACITY: 'Capacidad TVD insuficiente para publicar',
  TVD_CREDITS_BALANCE_INSUFFICIENT: 'Saldo TVD insuficiente para publicar',
  TVD_BALANCE_TEMPORARILY_UNAVAILABLE: 'No se pudo consultar el saldo TVD',
  TVD_CREDITS_MAX_TOKEN_INVALID: 'Limite TVD por eleccion invalido',
  TVD_CREDITS_MAX_TOKEN_EXCEEDED: 'La votacion supera el maximo TVD permitido por eleccion',
  TVD_CREDITS_SOURCE_CONFIG_MISMATCH: 'Fuente TVD contractual mal configurada',
  TVD_ALLOWANCE_INSUFFICIENT: 'Allowance TVD insuficiente para publicar',
  TVD_VOTE_MANAGER_CONFIG_INCOMPLETE: 'Configuracion del contrato de votacion incompleta',
  TVD_VOTE_MANAGER_IMPLEMENTATION_MISMATCH: 'Implementacion de votacion configurada no coincide',
  TVD_INSTITUTION_NOT_REGISTERED: 'Institucion no registrada en blockchain',
  TVD_WALLET_NOT_AUTHORIZED: 'Wallet institucional no autorizada en blockchain',
  TVD_VOTE_ALREADY_EXISTS: 'La votacion ya existe en blockchain',
  TVD_CREATE_VOTE_PREFLIGHT_REVERTED: 'Simulacion de publicacion rechazada',
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
    readonly details?: Record<string, string>,
  ) {
    super(messages[code]);
  }

  toHttpException() {
    const body = {
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    };
    if (
      this.code === 'TVD_RPC_UNAVAILABLE' ||
      this.code === 'TVD_BALANCE_TEMPORARILY_UNAVAILABLE' ||
      this.code === 'TVD_ASSIGN_REVERTED'
    ) {
      return new ServiceUnavailableException(body);
    }
    if (this.code === 'TVD_INSTITUTION_NOT_REGISTERED') {
      return new ConflictException(body);
    }

    return new BadRequestException(body);
  }
}
