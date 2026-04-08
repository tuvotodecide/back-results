import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsHexColor,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class AssignElectionPartiesBulkDto {
  @IsMongoId() electionId!: string;
  @IsArray() @IsString({ each: true }) partyIds!: string[];

  // Campos territoriales opcionales
  // Si se proporciona departmentId, los partidos se asignan solo a ese departamento
  // Si se proporciona municipalityId, los partidos se asignan solo a ese municipio
  // Si ambos son null/undefined, los partidos se asignan a nivel nacional
  @IsOptional() @IsMongoId() departmentId?: string;
  @IsOptional() @IsMongoId() municipalityId?: string;
}

export class RemoveElectionPartiesBulkDto {
  @IsMongoId() electionId!: string;
  @IsArray() @IsString({ each: true }) partyIds!: string[];

  // Campos territoriales para identificar qué registros eliminar
  @IsOptional() @IsMongoId() departmentId?: string;
  @IsOptional() @IsMongoId() municipalityId?: string;
}

export class UpdateElectionPartyDto {
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsNumber() ballotNumber?: number;
  @IsOptional() @IsString() allianceName?: string;
  @IsOptional() @IsHexColor() color?: string;
  @IsOptional() @IsArray() @ArrayNotEmpty() @IsHexColor({ each: true }) colors?: string[];
}
