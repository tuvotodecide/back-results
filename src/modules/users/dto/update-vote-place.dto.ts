import { ApiProperty } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { Types } from 'mongoose';
import { TransformObjectId } from '@/core/transforms/objectid.transform';

export class UpdateVotePlaceDto {
  @ApiProperty({ required: false, description: 'ID del recinto (ElectoralLocation)' })
  @IsOptional()
  @TransformObjectId()
  locationId?: Types.ObjectId | string;

  @ApiProperty({ required: false, description: 'ID de la mesa (ElectoralTable)' })
  @IsOptional()
  @TransformObjectId()
  tableId?: Types.ObjectId | string;

  @ApiProperty({ required: false, description: 'Código de mesa (tableCode) como alternativa a tableId' })
  @IsOptional()
  tableCode?: string;
}

export class VotePlaceResponseDto {
  userId: string;
  dni: string;
  location:
    | null
    | {
        _id: string;
        name?: string;
        address?: string;
        code?: string;
      };
  table:
    | null
    | {
        _id: string;
        tableCode?: string;
        tableNumber?: number;
      };
}
