import { Controller, Post, Body, Delete, Get, Param, Patch } from '@nestjs/common';
import { PoliticalPartyService } from '../services/political-party.service';
import {
  AssignElectionPartiesBulkDto,
  RemoveElectionPartiesBulkDto,
  UpdateElectionPartyDto,
} from '../dto/election-party.dto';
import { Public } from '@/core/decorators/public.decorator';

@Controller('political/election-parties')
export class ElectionPartyController {
  constructor(private readonly partyService: PoliticalPartyService) {}

  @Post('assign-bulk')
  assignBulk(@Body() dto: AssignElectionPartiesBulkDto) {
    return this.partyService.assignPartiesToElection(dto.electionId, dto.partyIds);
  }

  @Delete('remove-bulk')
  removeBulk(@Body() dto: RemoveElectionPartiesBulkDto) {
    return this.partyService.removePartiesFromElection(dto.electionId, dto.partyIds);
  }

  @Get('by-election/:electionId')
  @Public()
  getByElection(@Param('electionId') electionId: string) {
    return this.partyService.getElectionParties(electionId);
  }

  @Patch(':id')
  updateOne(@Param('id') id: string, @Body() dto: UpdateElectionPartyDto) {
    return this.partyService.updateElectionParty(id, dto);
  }
}
