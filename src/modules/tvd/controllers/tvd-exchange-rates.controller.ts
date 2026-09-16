import { Body, Controller, Get, Headers, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Public } from '@/core/decorators/public.decorator';
import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';
import {
  CreateTvdExchangeRateDto,
  ListTvdExchangeRatesQueryDto,
} from '../dto/tvd-exchange-rate.dto';
import { TvdExchangeRateAdminService } from '../services/tvd-exchange-rate-admin.service';

@Controller('api/v1/tvd/exchange-rates')
export class TvdExchangeRatesController {
  constructor(private readonly exchangeRateAdmin: TvdExchangeRateAdminService) {}

  @Post()
  @UseGuards(AdminOnlyGuard)
  createRate(
    @Body() dto: CreateTvdExchangeRateDto,
    @Req() req: any,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.exchangeRateAdmin.createRate(dto, req.user, idempotencyKey);
  }

  @Get()
  @UseGuards(AdminOnlyGuard)
  listRates(@Query() query: ListTvdExchangeRatesQueryDto) {
    return this.exchangeRateAdmin.listRates(query);
  }

  @Get('current')
  @UseGuards(AdminOnlyGuard)
  getCurrentRate() {
    return this.exchangeRateAdmin.getCurrentRate();
  }

  @Public()
  @Get('active-rate')
  async getActiveRate() {
    const rate = await this.exchangeRateAdmin.getCurrentRate();
    return {
      fiatCurrency: rate.fiatCurrency,
      bobPerToken: rate.bobPerToken,
    };
  }
}
