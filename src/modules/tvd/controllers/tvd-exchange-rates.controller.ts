import { Body, Controller, Get, Headers, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';
import {
  CreateTvdExchangeRateDto,
  ListTvdExchangeRatesQueryDto,
} from '../dto/tvd-exchange-rate.dto';
import { TvdExchangeRateAdminService } from '../services/tvd-exchange-rate-admin.service';

@Controller('api/v1/tvd/exchange-rates')
@UseGuards(AdminOnlyGuard)
export class TvdExchangeRatesController {
  constructor(private readonly exchangeRateAdmin: TvdExchangeRateAdminService) {}

  @Post()
  createRate(
    @Body() dto: CreateTvdExchangeRateDto,
    @Req() req: any,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.exchangeRateAdmin.createRate(dto, req.user, idempotencyKey);
  }

  @Get()
  listRates(@Query() query: ListTvdExchangeRatesQueryDto) {
    return this.exchangeRateAdmin.listRates(query);
  }

  @Get('current')
  getCurrentRate() {
    return this.exchangeRateAdmin.getCurrentRate();
  }
}
