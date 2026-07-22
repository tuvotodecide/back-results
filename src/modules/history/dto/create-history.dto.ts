import { ApiProperty } from "@nestjs/swagger";
import { IsDateString, IsEnum, IsMongoId, IsNotEmpty, IsOptional, IsString } from "class-validator";

export enum HistoryType {
  MULTISIG = 'multisig',
  OWNER = 'owner',
  AUTOMATED = 'automated',
}

export enum HistoryOperationKey {
  setCoreBlockDuraion = 'Cambio del periodo de congelamiento para el bloque Core',
  addBeneficiary = 'Nuevo beneficiado para el bloque Core',
  revokeBeneficiary = 'Beneficiado del bloque Core eliminado',
  submitMultisigTx = 'Acción multisig propuesto',
  confirmMultisigTx = 'Acción multisig aprobado',
  revokeMultisigConfirm = 'Aprobación multisig eliminado',
  executeMultisigTx = 'Acción multisig ejecutado',
  addMultisigOwner = 'Nuevo participante multisig',
  removeMultisigOwner = 'Participante multisig eliminado',
  changeMultisigReq = 'Umbral multisig actualizado',

  setInstDuration = 'Asignación institucional: Duración de bloqueo actualizado',
  assignInst = 'Asignación institucional: Tokens asignados',
  buyInst = 'Asignación institucional: Tokens comprados',
  releasedInst = 'Asignación institucional: Tokens reclamados',

  createIncentiveCamp = 'Campaña de incentivo creada',
  pauseIncentive = 'Campaña de incentivo pausada',
  unpauseIncentive = 'Campaña de incentivo renaudada',
  grantIncentive = 'Incentivo otorgado',
  releaseIncentive = 'Incentivo reclamado',
  
  institutionCreated = 'Institución creada',
  institutionWalletAdded = 'Institución: nueva wallet asignada',
  institutionAdminSet = 'Institución: cambio de admin',

  setBurnBps = 'Porcentaje de quema actualizado',
  setTvdPerCredit = 'Valor de TVD por voto actualizado',
  createElection = 'Elección creada',
  updateElectionDates = 'Fechas de elección actualizadas',
  updateRegisteredVoters = 'Votantes registrados actualizados',
  disableElection = 'Elección deshabilitada',
  castVote = 'Voto emitido',
  electionLiquidated = 'Elección liquidada',
  claimVoteReward = 'Recompensa por voto reclamada'
}

export type HistoryOperationRelatedFnEntry = {
  fn: string[];
  isEvent: boolean;
  amountParam: string;
};

export const HistoryOperationRelatedFn: Record<string, HistoryOperationRelatedFnEntry> = {
  assignInst: {
    fn: ['function assign(address institution, uint256 amount)'],
    isEvent: false,
    amountParam: 'amount',
  },
  buyInst: {
    fn: ['function assign(address institution, uint256 amount)'],
    isEvent: false,
    amountParam: 'amount',
  },
  releasedInst: {
    fn: ['event TokensReleased(address indexed institution, uint256 amount)'],
    isEvent: true,
    amountParam: 'amount',
  },
  grantIncentive: {
    fn: [
      'event IncentiveAssigned(uint256 indexed campaignId, address indexed recipient, uint256 amount)',
      'event IncentiveTransferred(uint256 indexed campaignId, address indexed recipient, uint256 amount)'
    ],
    isEvent: true,
    amountParam: 'amount'
  },
  releaseIncentive: {
    fn: ['event IncentiveClaimed(uint256 indexed campaignId, address indexed recipient, uint256 amount)'],
    isEvent: true,
    amountParam: 'amount'
  },
  setTvdPerCredit: {
    fn: ['function setTvdPerCredit(uint256 newRate)'],
    isEvent: false,
    amountParam: 'newRate'
  },
  createElection: {
    fn: ['event TopUp(address indexed institution, uint256 electionId, uint256 creditsPurchased, uint256 tvdLocked)'],
    isEvent: true,
    amountParam: 'tvdLocked'
  },
  castVote: {
    fn: ['event VoteConsumed(address indexed institution, uint256 electionId, uint256 tvdAccrued)'],
    isEvent: true,
    amountParam: 'tvdAccrued'
  },
}

export class CreateHistoryDto {
  @ApiProperty({ example: '0x2415236' })
  @IsString()
  @IsNotEmpty()
  txHash!: string;

  @ApiProperty({ enum: HistoryOperationKey, example: HistoryOperationKey.setTvdPerCredit })
  @IsString()
  @IsNotEmpty()
  operationName!: string;

  @ApiProperty({ example: 'Ajuste de precio 2' })
  @IsString()
  @IsOptional()
  @IsNotEmpty()
  description?: string;

  @ApiProperty({ enum: HistoryType, example: HistoryType.MULTISIG })
  @IsEnum(HistoryType)
  type!: HistoryType;
  
  @ApiProperty({ example: '2026-07-16T12:00:00.000Z' })
  @IsDateString()
  registerDate!: string;

  @ApiProperty({ example: '64f1a2b3c4d5e6f7a8b9c0d1', required: false })
  @IsOptional()
  @IsMongoId()
  roledUserId?: string;

  @ApiProperty({ example: '64f1a2b3c4d5e6f7a8b9c0d2', required: false })
  @IsOptional()
  @IsMongoId()
  institutionId?: string;

  @ApiProperty({ example: '64f1a2b3c4d5e6f7a8b9c0d2', required: false })
  @IsOptional()
  @IsMongoId()
  electionId?: string;
}
