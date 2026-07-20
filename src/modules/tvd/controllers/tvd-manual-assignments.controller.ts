import { Body, Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';
import { CreateTvdManualAssignmentDto } from '../dto/tvd-manual-assignment.dto';
import { TvdManualAssignmentsService } from '../services/tvd-manual-assignments.service';

@Controller('api/v1/tvd/manual-assignments')
@UseGuards(AdminOnlyGuard)
export class TvdManualAssignmentsController {
  constructor(private readonly manualAssignments: TvdManualAssignmentsService) {}

  @Post()
  createManualAssignment(
    @Body() dto: CreateTvdManualAssignmentDto,
    @Req() req: any,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.manualAssignments.createManualAssignment(
      dto,
      req.user,
      idempotencyKey,
    );
  }

  @Get(':accreditationId')
  getManualAssignment(
    @Param('accreditationId') accreditationId: string,
    @Req() req: any,
  ) {
    return this.manualAssignments.getManualAssignment(accreditationId, req.user);
  }
}
