import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthController } from './controllers/auth.controller';
import { AuthService } from './services/auth.service';
import { RoledUser, RoledUserSchema } from './schemas/roledUser.schema';
import { Department, DepartmentSchema } from '../geographic/schemas/department.schema';
import { Municipality, MunicipalitySchema } from '../geographic/schemas/municipality.schema';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { MailModule } from '../mail/mail.module';
import {
  TenantAdminAssignment,
  TenantAdminAssignmentSchema,
} from '../institutional-tenants/schemas/tenant-admin-assignment.schema';
import {
  InstitutionalAdminApplication,
  InstitutionalAdminApplicationSchema,
} from '../institutional-admin-applications/schemas/institutional-admin-application.schema';
import {
  InstitutionalTenant,
  InstitutionalTenantSchema,
} from '../institutional-tenants/schemas/institutional-tenant.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: RoledUser.name, schema: RoledUserSchema }]),
    MongooseModule.forFeature([{ name: Department.name, schema: DepartmentSchema }]),
    MongooseModule.forFeature([{ name: Municipality.name, schema: MunicipalitySchema }]),
    MongooseModule.forFeature([
      { name: TenantAdminAssignment.name, schema: TenantAdminAssignmentSchema },
    ]),
    MongooseModule.forFeature([
      {
        name: InstitutionalAdminApplication.name,
        schema: InstitutionalAdminApplicationSchema,
      },
    ]),
    MongooseModule.forFeature([
      {
        name: InstitutionalTenant.name,
        schema: InstitutionalTenantSchema,
      },
    ]),
    JwtModule.registerAsync({
      global: true,
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('app.jwt.secret'),
        signOptions: { expiresIn: configService.get('app.jwt.expirationTime') },
      }),
      inject: [ConfigService],
    }),
    MailModule,
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
