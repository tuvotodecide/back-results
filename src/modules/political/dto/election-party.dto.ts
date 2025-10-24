import { IsArray, IsMongoId, IsOptional, IsString, IsBoolean, IsNumber } from 'class-validator';

export class AssignElectionPartiesBulkDto {
  @IsMongoId() electionId!: string;
  @IsArray() @IsString({ each: true }) partyIds!: string[];
}

export class RemoveElectionPartiesBulkDto {
  @IsMongoId() electionId!: string;
  @IsArray() @IsString({ each: true }) partyIds!: string[];
}

export class UpdateElectionPartyDto {
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsNumber() ballotNumber?: number;
  @IsOptional() @IsString() allianceName?: string;
  @IsOptional() @IsString() color?: string;
}
