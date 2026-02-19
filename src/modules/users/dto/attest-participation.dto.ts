import { ApiProperty } from '@nestjs/swagger';
import {
  IsEthereumAddress,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class AttestParticipationDto {
  @ApiProperty({
    description: 'Dirección del smart account / wallet del usuario',
    example: '0x1234567890abcdef1234567890abcdef12345678',
  })
  @IsEthereumAddress()
  account: string;

  @ApiProperty({
    description: 'URL de la imagen',
    example: 'https://ipfs.io/ipfs/Qm.../image.png',
  })
  @IsString()
  @IsNotEmpty()
  imageUrl: string;

  @ApiProperty({
    required: false,
    description: 'ID de la elección para asociar el certificado',
    example: '690987c80d23d3737e5af3cb',
  })
  @IsOptional()
  @IsString()
  electionId?: string;

  @ApiProperty({
    required: false,
    description: 'URL/IPFS del JSON del acta para navegación desde notificaciones',
    example: 'https://ipfs.io/ipfs/Qm...',
  })
  @IsOptional()
  @IsString()
  ipfsUri?: string;

  @ApiProperty({
    required: false,
    description: 'URL de imagen del acta para navegación desde notificaciones',
    example: 'https://ipfs.io/ipfs/Qm.../acta.png',
  })
  @IsOptional()
  @IsString()
  actaImageUrl?: string;
}

export class AttestParticipationResponseDto {
  @ApiProperty()
  userId: string;

  @ApiProperty()
  dni: string;

  @ApiProperty()
  imageUrl: string;

  @ApiProperty()
  txHash: string;

  @ApiProperty()
  chainId: number;

  @ApiProperty()
  contractAddress: string;

  @ApiProperty({ required: false })
  electionId?: string | null;

  @ApiProperty({ required: false })
  ipfsUri?: string | null;

  @ApiProperty({ required: false })
  actaImageUrl?: string | null;
}

// Para listar certificados
export class ParticipationCertificateDto {
  @ApiProperty()
  imageUrl: string;

  @ApiProperty()
  txHash: string;

  @ApiProperty()
  chainId: number;

  @ApiProperty()
  contractAddress: string;

  @ApiProperty({ required: false })
  electionId?: string | null;

  @ApiProperty()
  createdAt: Date;
}
