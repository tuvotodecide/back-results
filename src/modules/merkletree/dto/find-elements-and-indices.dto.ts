import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsMongoId, IsNotEmpty, IsString } from 'class-validator';

export enum MerkleTreeType {
  CI = 'ci',
  VOTE = 'vote',
}

export class FindElementsAndIndicesDto {
  @ApiProperty({ example: '64f1a2b3c4d5e6f7a8b9c0d2', description: 'Id de la elección' })
  @IsMongoId()
  electionId!: string;

  @ApiProperty({ enum: MerkleTreeType, example: MerkleTreeType.CI, description: 'Árbol de merkle a consultar' })
  @IsEnum(MerkleTreeType)
  type!: MerkleTreeType;

  @ApiProperty({
    example: '1234567',
    description:
      'Valor de la hoja: CI del votante para type=ci, o el hash de voto (decimal/hex) para type=vote',
  })
  @IsString()
  @IsNotEmpty()
  leaf!: string;
}
