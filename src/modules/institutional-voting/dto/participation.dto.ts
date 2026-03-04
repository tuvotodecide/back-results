import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateParticipationDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  carnet: string;
}
