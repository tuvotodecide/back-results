import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";

export class PublishEventItemDto {
  @ApiProperty({ description: 'ID del usuario' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty({ description: 'Nullifier del usuario' })
  @IsString()
  @IsNotEmpty()
  nullifier: string;
}