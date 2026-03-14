import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsString, ValidateNested } from 'class-validator';

class OptionCandidateDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  photoUrl: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  roleName: string;
}

export class UpdateOptionCandidatesDto {
  @ApiProperty({ type: [OptionCandidateDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OptionCandidateDto)
  candidates: OptionCandidateDto[];
}
