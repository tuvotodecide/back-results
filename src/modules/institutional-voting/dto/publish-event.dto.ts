import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";

export class PublishEventItemDto {
  @ApiProperty({ description: 'nullifier para un usuario'})
  @IsString()
  @IsNotEmpty()
  nullifier: string;
}