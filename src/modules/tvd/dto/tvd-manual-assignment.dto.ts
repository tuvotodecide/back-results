import {
  IsMongoId,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateTvdManualAssignmentDto {
  @IsMongoId()
  tenantId!: string;

  @IsMongoId()
  assignmentId!: string;

  @IsString()
  @Matches(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, {
    message: 'tokenAmount must be a positive decimal string',
  })
  tokenAmount!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(240)
  reason!: string;
}
