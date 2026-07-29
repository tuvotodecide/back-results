import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';
import {
  TvdAdminAccreditationListQueryDto,
  TvdAdminInstitutionListQueryDto,
  TvdAdminOperationsQueryDto,
} from '../dto/tvd-query.dto';
import { TvdAdminWalletLookupQueryDto } from '../dto/tvd-wallet-lookup.dto';
import { TvdQueryService } from '../services/tvd-query.service';
import { TvdWalletLookupService } from '../services/tvd-wallet-lookup.service';
import { TvdAccreditationWorkerService } from '../services/tvd-accreditation-worker.service';

@Controller('api/v1/tvd/admin')
@UseGuards(AdminOnlyGuard)
export class TvdAdminController {
  constructor(
    private readonly tvdQueries: TvdQueryService,
    private readonly walletLookup: TvdWalletLookupService,
    private readonly accreditationWorker: TvdAccreditationWorkerService,
  ) {}

  @Get('institutions')
  listInstitutions(
    @Query() query: TvdAdminInstitutionListQueryDto,
    @Req() req: any,
  ) {
    return this.tvdQueries.listAdminInstitutions(query, req.user);
  }

  @Get('wallet-lookup')
  lookupWallet(@Query() query: TvdAdminWalletLookupQueryDto) {
    return this.walletLookup.lookupAdminWallet(query.accountAddress);
  }

  @Get('operations')
  listOperations(
    @Query() query: TvdAdminOperationsQueryDto,
    @Req() req: any,
  ) {
    return this.tvdQueries.listAdminOperations(query, req.user);
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

  @Get('accreditations/worker/status')
  getAccreditationWorkerStatus() {
    return this.accreditationWorker.getWorkerStatus();
  }

  @Get('accreditations/:accreditationId')
  getAccreditation(
    @Param('accreditationId') accreditationId: string,
    @Req() req: any,
  ) {
    return this.tvdQueries.getAdminAccreditation(accreditationId, req.user);
  }
}
