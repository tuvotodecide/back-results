import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { RoledUser, RoledUserSchema } from '@/modules/auth/schemas/roledUser.schema';
import { InstitutionalAuditModule } from '@/modules/institutional-audit/institutional-audit.module';
import {
  PaymentTransaction,
  PaymentTransactionSchema,
} from '@/modules/payments/schemas/payment-transaction.schema';
import {
  InstitutionalTenant,
  InstitutionalTenantSchema,
} from '@/modules/institutional-tenants/schemas/institutional-tenant.schema';
import {
  TenantAdminAssignment,
  TenantAdminAssignmentSchema,
} from '@/modules/institutional-tenants/schemas/tenant-admin-assignment.schema';
import { TvdManualAssignmentsController } from './controllers/tvd-manual-assignments.controller';
import { TvdExchangeRatesController } from './controllers/tvd-exchange-rates.controller';
import { TvdAdminController } from './controllers/tvd-admin.controller';
import { TvdMeController } from './controllers/tvd-me.controller';
import {
  TokenAccreditation,
  TokenAccreditationSchema,
} from './schemas/token-accreditation.schema';
import {
  TvdOperatorTransactionLock,
  TvdOperatorTransactionLockSchema,
} from './schemas/tvd-operator-transaction-lock.schema';
import {
  TvdExchangeRate,
  TvdExchangeRateSchema,
} from './schemas/tvd-exchange-rate.schema';
import { TokenAccreditationsService } from './services/token-accreditations.service';
import { TvdAccreditationProcessorService } from './services/tvd-accreditation-processor.service';
import { TvdAccreditationReconciliationService } from './services/tvd-accreditation-reconciliation.service';
import { TvdAccreditationWorkerService } from './services/tvd-accreditation-worker.service';
import { createViemTvdBlockchainClients } from './services/tvd-blockchain-client.factory';
import { TvdBlockchainService } from './services/tvd-blockchain.service';
import { TvdConversionService } from './services/tvd-conversion.service';
import { TvdExchangeRatesService } from './services/tvd-exchange-rates.service';
import { TvdExchangeRateAdminService } from './services/tvd-exchange-rate-admin.service';
import { TvdManualAssignmentsService } from './services/tvd-manual-assignments.service';
import { TvdQuotesService } from './services/tvd-quotes.service';
import { TvdQrAccreditationsService } from './services/tvd-qr-accreditations.service';
import { TvdReceiptValidatorService } from './services/tvd-receipt-validator.service';
import { TvdOperatorTransactionLockService } from './services/tvd-operator-transaction-lock.service';
import { TVD_BLOCKCHAIN_CLIENT_FACTORY } from './types/tvd-blockchain.types';
import { TvdQueryService } from './services/tvd-query.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('app.jwt.secret'),
        signOptions: { expiresIn: configService.get('app.jwt.expirationTime') },
      }),
      inject: [ConfigService],
    }),
    InstitutionalAuditModule,
    MongooseModule.forFeature([
      { name: TvdExchangeRate.name, schema: TvdExchangeRateSchema },
      { name: TokenAccreditation.name, schema: TokenAccreditationSchema },
      {
        name: TvdOperatorTransactionLock.name,
        schema: TvdOperatorTransactionLockSchema,
      },
      { name: PaymentTransaction.name, schema: PaymentTransactionSchema },
      { name: InstitutionalTenant.name, schema: InstitutionalTenantSchema },
      { name: TenantAdminAssignment.name, schema: TenantAdminAssignmentSchema },
      { name: RoledUser.name, schema: RoledUserSchema },
    ]),
  ],
  controllers: [
    TvdManualAssignmentsController,
    TvdExchangeRatesController,
    TvdMeController,
    TvdAdminController,
  ],
  providers: [
    TvdConversionService,
    TvdExchangeRatesService,
    TvdExchangeRateAdminService,
    TvdQuotesService,
    TokenAccreditationsService,
    TvdAccreditationProcessorService,
    TvdAccreditationReconciliationService,
    TvdAccreditationWorkerService,
    TvdOperatorTransactionLockService,
    TvdManualAssignmentsService,
    TvdQrAccreditationsService,
    TvdReceiptValidatorService,
    TvdBlockchainService,
    TvdQueryService,
    {
      provide: TVD_BLOCKCHAIN_CLIENT_FACTORY,
      useValue: createViemTvdBlockchainClients,
    },
  ],
  exports: [
    TvdConversionService,
    TvdExchangeRatesService,
    TvdExchangeRateAdminService,
    TvdQuotesService,
    TokenAccreditationsService,
    TvdAccreditationProcessorService,
    TvdAccreditationReconciliationService,
    TvdAccreditationWorkerService,
    TvdOperatorTransactionLockService,
    TvdManualAssignmentsService,
    TvdQrAccreditationsService,
    TvdReceiptValidatorService,
    TvdBlockchainService,
    TvdQueryService,
  ],
})
export class TvdModule {}
