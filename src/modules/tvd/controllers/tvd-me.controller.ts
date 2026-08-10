import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '@/core/guards/jwt-auth.guard';
import { PaymentListQueryDto } from '@/modules/payments/dto/payment-query.dto';
import { TvdEstimatedCapacityRequestDto } from '../dto/tvd-capacity.dto';
import { TvdMyQuoteQueryDto } from '../dto/tvd-quote.dto';
import { TvdAccreditationListQueryDto } from '../dto/tvd-query.dto';
import { TvdCapacityService } from '../services/tvd-capacity.service';
import { TvdQueryService } from '../services/tvd-query.service';
import { TvdQuotesService } from '../services/tvd-quotes.service';

type TvdRequester = {
  sub?: string;
  role?: string;
  active?: boolean;
  tenantId?: string;
};

type AuthenticatedTvdRequest = Request & {
  user: TvdRequester;
};

@Controller('api/v1/tvd/me')
@UseGuards(JwtAuthGuard)
export class TvdMeController {
  constructor(
    private readonly tvdQueries: TvdQueryService,
    private readonly tvdQuotes: TvdQuotesService,
    private readonly tvdCapacity: TvdCapacityService,
  ) {}

  @Get('summary')
  getSummary(@Query('tenantId') tenantId: string | undefined, @Req() req: any) {
    return this.tvdQueries.getMySummary(req.user, tenantId);
  }

  @Get('accreditations')
  listAccreditations(
    @Query() query: TvdAccreditationListQueryDto,
    @Req() req: any,
  ) {
    return this.tvdQueries.listMyAccreditations(query, req.user);
  }

  @Get('accreditations/:accreditationId')
  getAccreditation(
    @Param('accreditationId') accreditationId: string,
    @Req() req: any,
  ) {
    return this.tvdQueries.getMyAccreditation(accreditationId, req.user);
  }

  @Get('payments')
  listPayments(@Query() query: PaymentListQueryDto, @Req() req: any) {
    return this.tvdQueries.listMyPayments(query, req.user);
  }

  @Get('payments/:paymentId')
  getPayment(
    @Param('paymentId') paymentId: string,
    @Query('tenantId') tenantId: string | undefined,
    @Req() req: any,
  ) {
    return this.tvdQueries.getMyPayment(paymentId, req.user, tenantId);
  }

  @Get('quote')
  async getQuote(
    @Query() query: TvdMyQuoteQueryDto,
    @Req() req: AuthenticatedTvdRequest,
  ) {
    await this.tvdQueries.resolveMyInstitutionalWallet(req.user, query.tenantId);
    return this.tvdQuotes.createInstitutionalQuote(query);
  }

  @Post('estimated-capacity')
  estimateCapacity(
    @Body() dto: TvdEstimatedCapacityRequestDto,
    @Req() req: AuthenticatedTvdRequest,
  ) {
    return this.tvdCapacity.estimateCapacity(
      dto.estimatedParticipants,
      req.user,
      dto.tenantId,
    );
  }
}
