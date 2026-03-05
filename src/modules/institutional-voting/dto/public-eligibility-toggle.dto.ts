import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdatePublicEligibilityDto {
  @ApiProperty()
  @IsBoolean()
  enabled: boolean;
}
