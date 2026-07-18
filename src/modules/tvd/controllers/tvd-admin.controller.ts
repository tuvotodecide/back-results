import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';
import {
  TvdAdminAccreditationListQueryDto,
  TvdAdminInstitutionListQueryDto,
} from '../dto/tvd-query.dto';
import { TvdQueryService } from '../services/tvd-query.service';

@Controller('api/v1/tvd/admin')
@UseGuards(AdminOnlyGuard)
export class TvdAdminController {
  constructor(private readonly tvdQueries: TvdQueryService) {}

  @Get('institutions')
  listInstitutions(
    @Query() query: TvdAdminInstitutionListQueryDto,
    @Req() req: any,
  ) {
    return this.tvdQueries.listAdminInstitutions(query, req.user);
  }

  @Get('institutions/:tenantId/wallets')
  listInstitutionWallets(@Param('tenantId') tenantId: string, @Req() req: any) {
    return this.tvdQueries.listAdminInstitutionWallets(tenantId, req.user);
  }

  @Get('accreditations')
  listAccreditations(
    @Query() query: TvdAdminAccreditationListQueryDto,
    @Req() req: any,
  ) {
    return this.tvdQueries.listAdminAccreditations(query, req.user);
  }

  @Get('accreditations/:accreditationId')
  getAccreditation(
    @Param('accreditationId') accreditationId: string,
    @Req() req: any,
  ) {
    return this.tvdQueries.getAdminAccreditation(accreditationId, req.user);
  }
}
