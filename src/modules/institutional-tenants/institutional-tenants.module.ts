import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { InstitutionalAuditModule } from '../institutional-audit/institutional-audit.module';
import { RoledUser, RoledUserSchema } from '../auth/schemas/roledUser.schema';
import { InstitutionalTenantsController } from './controllers/institutional-tenants.controller';
import { InstitutionalTenantAdminGuard } from './guards/institutional-tenant-admin.guard';
import { InstitutionalTenantsService } from './services/institutional-tenants.service';
import {
  InstitutionalTenant,
  InstitutionalTenantSchema,
} from './schemas/institutional-tenant.schema';
import {
  TenantAdminAssignment,
  TenantAdminAssignmentSchema,
} from './schemas/tenant-admin-assignment.schema';
import {
  InstitutionalAdminApplication,
  InstitutionalAdminApplicationSchema,
} from '../institutional-admin-applications/schemas/institutional-admin-application.schema';
import {
  NotificationLog,
  NotificationLogSchema,
} from '../notifications/schemas/notification-log.schema';

@Module({
  imports: [
    HttpModule,
    MongooseModule.forFeature([
      { name: InstitutionalTenant.name, schema: InstitutionalTenantSchema },
      { name: TenantAdminAssignment.name, schema: TenantAdminAssignmentSchema },
      { name: RoledUser.name, schema: RoledUserSchema },
      { name: InstitutionalAdminApplication.name, schema: InstitutionalAdminApplicationSchema },
      { name: NotificationLog.name, schema: NotificationLogSchema },
    ]),
    JwtModule.registerAsync({
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('app.jwt.secret'),
        signOptions: { expiresIn: configService.get('app.jwt.expirationTime') },
      }),
      inject: [ConfigService],
    }),
    InstitutionalAuditModule,
  ],
  controllers: [InstitutionalTenantsController],
  providers: [InstitutionalTenantsService, InstitutionalTenantAdminGuard],
  exports: [InstitutionalTenantsService],
})
export class InstitutionalTenantsModule {}
