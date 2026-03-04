import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class EligibilityQueryDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  carnet: string;
}
