import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/core/guards/jwt-auth.guard';
import { PaymentListQueryDto } from '@/modules/payments/dto/payment-query.dto';
import { TvdAccreditationListQueryDto } from '../dto/tvd-query.dto';
import { TvdQueryService } from '../services/tvd-query.service';

@Controller('api/v1/tvd/me')
@UseGuards(JwtAuthGuard)
export class TvdMeController {
  constructor(private readonly tvdQueries: TvdQueryService) {}

  @Get('summary')
  getSummary(@Req() req: any) {
    return this.tvdQueries.getMySummary(req.user);
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
  getPayment(@Param('paymentId') paymentId: string, @Req() req: any) {
    return this.tvdQueries.getMyPayment(paymentId, req.user);
  }
}
