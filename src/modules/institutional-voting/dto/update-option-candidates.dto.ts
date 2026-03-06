import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';

class OptionCandidateDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  photoUrl?: string;

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
