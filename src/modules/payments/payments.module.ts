import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { RoledUser, RoledUserSchema } from '@/modules/auth/schemas/roledUser.schema';
import { InstitutionalTenant, InstitutionalTenantSchema } from '@/modules/institutional-tenants/schemas/institutional-tenant.schema';
import { TenantAdminAssignment, TenantAdminAssignmentSchema } from '@/modules/institutional-tenants/schemas/tenant-admin-assignment.schema';
import { TvdModule } from '@/modules/tvd/tvd.module';
import { PaymentsController } from './controllers/payments.controller';
import { RedEnlaceWebhookController } from './controllers/red-enlace-webhook.controller';
import { RedEnlaceWebhookGuard } from './guards/red-enlace-webhook.guard';
import { QR_PAYMENT_PROVIDER } from './payments.constants';
import { createQrPaymentProvider } from './providers/qr-payment-provider.factory';
import { MockRedEnlaceQrProvider } from './providers/mock-red-enlace-qr.provider';
import { RedEnlaceQrHttpProvider } from './providers/red-enlace-qr-http.provider';
import { PaymentProviderEvent, PaymentProviderEventSchema } from './schemas/payment-provider-event.schema';
import { PaymentTransaction, PaymentTransactionSchema } from './schemas/payment-transaction.schema';
import { PaymentTenantAccessService } from './services/payment-tenant-access.service';
import { PaymentReconciliationService } from './services/payment-reconciliation.service';
import { PaymentTransactionsService } from './services/payment-transactions.service';
import { RedEnlaceWebhookService } from './services/red-enlace-webhook.service';

@Module({
  imports: [
    HttpModule,
    TvdModule,
    MongooseModule.forFeature([
      { name: PaymentTransaction.name, schema: PaymentTransactionSchema },
      { name: PaymentProviderEvent.name, schema: PaymentProviderEventSchema },
      { name: InstitutionalTenant.name, schema: InstitutionalTenantSchema },
      { name: TenantAdminAssignment.name, schema: TenantAdminAssignmentSchema },
      { name: RoledUser.name, schema: RoledUserSchema },
    ]),
  ],
  controllers: [PaymentsController, RedEnlaceWebhookController],
  providers: [
    PaymentTenantAccessService,
    PaymentReconciliationService,
    PaymentTransactionsService,
    RedEnlaceWebhookService,
    RedEnlaceWebhookGuard,
    MockRedEnlaceQrProvider,
    RedEnlaceQrHttpProvider,
    {
      provide: QR_PAYMENT_PROVIDER,
      inject: [ConfigService, MockRedEnlaceQrProvider, RedEnlaceQrHttpProvider],
      useFactory: createQrPaymentProvider,
    },
  ],
  exports: [PaymentTransactionsService, PaymentReconciliationService],
})
export class PaymentsModule {}
