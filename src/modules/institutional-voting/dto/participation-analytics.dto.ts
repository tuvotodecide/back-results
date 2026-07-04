import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export type ParticipationAnalyticsStatus =
  | 'IN_PROGRESS'
  | 'FINISHED'
  | 'RESULTS_PUBLISHED'
  | 'RESULTS_NOT_PUBLISHED';

export class ParticipationAnalyticsResponseDto {
  @ApiProperty()
  votingId!: string;

  @ApiProperty()
  votingName!: string;

  @ApiPropertyOptional()
  institutionName?: string;

  @ApiProperty({
    enum: ['IN_PROGRESS', 'FINISHED', 'RESULTS_PUBLISHED', 'RESULTS_NOT_PUBLISHED'],
  })
  status!: ParticipationAnalyticsStatus;

  @ApiProperty({ nullable: true })
  publishedAt!: string | null;

  @ApiProperty()
  totalEnabled!: number;

  @ApiProperty()
  totalParticipated!: number;

  @ApiProperty()
  totalPending!: number;

  @ApiProperty()
  participationPercentage!: number;
}

export type ParticipationReportVoterStatus = 'PARTICIPATED' | 'PENDING';

export type ParticipationReportVoter = {
  id: string;
  carnetNorm: string;
  status: ParticipationReportVoterStatus;
};

export type ParticipationReportData = ParticipationAnalyticsResponseDto & {
  generatedAt: string;
  participants: ParticipationReportVoter[];
  pending: ParticipationReportVoter[];
};

export class CreateParticipationReportDto {
  @ApiPropertyOptional({
    description: 'Captura real del modal de analíticas como data URL base64.',
    example: 'data:image/png;base64,iVBORw0KGgo...',
  })
  @IsOptional()
  @IsString()
  modalScreenshot?: string;

  @ApiPropertyOptional({
    description: 'Variante legacy: captura del modal en base64 sin prefijo data URL.',
  })
  @IsOptional()
  @IsString()
  modalScreenshotBase64?: string;
}
