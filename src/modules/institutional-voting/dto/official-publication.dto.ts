import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ConfirmOfficialPublicationDto {
  @ApiPropertyOptional({ description: 'Hash de transacción confirmado por frontend/MetaMask' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  txHash?: string;

  @ApiPropertyOptional({ description: 'Wallet que confirmó la publicación oficial' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  wallet?: string;

  @ApiPropertyOptional({ description: 'Chain id usada para la publicación oficial' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  chainId?: string;
}
