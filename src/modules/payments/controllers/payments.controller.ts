import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';
import { CreateQrPaymentDto } from '../dto/create-qr-payment.dto';
import { PaymentListQueryDto } from '../dto/payment-query.dto';
import { ReconcilePaymentDto } from '../dto/reconcile-payment.dto';
import { PaymentTransactionsService } from '../services/payment-transactions.service';

@Controller('api/v1/payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentTransactionsService) {}

  @Post('qr')
  createQrPayment(
    @Body() dto: CreateQrPaymentDto,
    @Req() req: any,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.payments.createQrPayment(dto, req.user, idempotencyKey);
  }

  @Get()
  listPayments(@Query() query: PaymentListQueryDto, @Req() req: any) {
    return this.payments.listPayments(query, req.user);
  }

  @Get(':paymentId')
  getPayment(@Param('paymentId') paymentId: string, @Req() req: any) {
    return this.payments.getPayment(paymentId, req.user);
  }

  @Post(':paymentId/regenerate')
  regeneratePayment(
    @Param('paymentId') paymentId: string,
    @Req() req: any,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.payments.regenerateQrPayment(
      paymentId,
      req.user,
      idempotencyKey,
    );
  }

  @Post(':paymentId/reconcile')
  @UseGuards(AdminOnlyGuard)
  reconcilePayment(
    @Param('paymentId') paymentId: string,
    @Body() dto: ReconcilePaymentDto,
    @Req() req: any,
  ) {
    return this.payments.reconcilePayment(paymentId, req.user, dto);
  }
}
