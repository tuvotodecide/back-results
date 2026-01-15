import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { RoledUser, RoledUserDocument } from '../schemas/roledUser.schema';
import { RegisterRoledUserDto } from '../dto/register-roled-user.dto';
import bcrypt from 'bcrypt';
import { Department } from '@/modules/geographic/schemas/department.schema';
import { Municipality } from '@/modules/geographic/schemas/municipality.schema';
import { SignInDto, SignInResponseDto } from '../dto/sign-in.dto';
import { JwtService } from '@nestjs/jwt';
import { MailService } from '@/modules/mail/mail.service';
import { randomBytes } from 'crypto';
import { RequestPasswordResetDto, ResetPasswordDto } from '../dto/password-reset.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(RoledUser.name) private roledUserModel: Model<RoledUserDocument>,
    @InjectModel(Department.name) private departmentModel: Model<Department>,
    @InjectModel(Municipality.name) private municipalityModel: Model<Municipality>,
    private jwtService: JwtService,
    private mailService: MailService,
    private configService: ConfigService,
  ) {}

  async register(dto: RegisterRoledUserDto): Promise<RoledUserDocument> {
    if ((!dto.votingDepartmentId && !dto.votingMunicipalityId) || (dto.votingDepartmentId && dto.votingMunicipalityId)) {
      throw new BadRequestException(
        'Debe proporcionar un ID de departamento o municipio de votación',
      );
    }

    if (
      dto.votingDepartmentId &&
      !(await this.departmentModel.exists({ _id: dto.votingDepartmentId }))
    ) {
      throw new BadRequestException('El departamento de votación proporcionado no existe');
    }

    if (
      dto.votingMunicipalityId &&
      !(await this.municipalityModel.exists({ _id: dto.votingMunicipalityId }))
    ) {
      throw new BadRequestException('El municipio de votación proporcionado no existe');
    }

    const verificationToken = randomBytes(32).toString('hex');
    const verificationTokenExpiresAt = new Date(Date.now() + 1000 * 60 * 60 * this.configService.get<number>('app.mail.verificationTokenTTLHours', 24));

    const payload: Partial<RoledUser> = {
      dni: dto.dni,
      email: dto.email,
      name: dto.name,
      password: bcrypt.hashSync(dto.password, 10),
      role: dto.votingDepartmentId ? 'GOVERNOR' : 'MAYOR',
      votingDepartmentId: dto.votingDepartmentId
        ? new Types.ObjectId(dto.votingDepartmentId)
        : null,
      votingMunicipalityId: dto.votingMunicipalityId
        ? new Types.ObjectId(dto.votingMunicipalityId)
        : null,
      active: false,
      verificationToken,
      verificationTokenExpiresAt,
    };

    let user: RoledUserDocument | undefined;
    try {
      user = await this.roledUserModel.create(payload);
      await this.sendVerificationEmail(user.email, user.name, verificationToken);
      return user;
    } catch (error: any) {
      if (error?.code === 11000) {
        throw new BadRequestException('Usuario ya registrado para el DNI o correo electrónico proporcionado');
      }
      if (user) {
        await this.roledUserModel.deleteOne({ _id: user._id });
      }
      throw error;
    }
  }

  async verifyEmail(token: string): Promise<RoledUserDocument> {
    const user = await this.roledUserModel.findOne({ verificationToken: token });

    if (!user) {
      throw new BadRequestException('Token de verificación inválido');
    }

    if (
      user.verificationTokenExpiresAt &&
      user.verificationTokenExpiresAt.getTime() < Date.now()
    ) {
      throw new BadRequestException('El token de verificación ha expirado');
    }

    user.verificationToken = undefined;
    user.verificationTokenExpiresAt = undefined;

    await user.save();

    return user;
  }

  async signIn(dto: SignInDto): Promise<SignInResponseDto> {
    const user = await this.roledUserModel.findOne({ email: dto.email });
    if (!user) {
      throw new ForbiddenException('Credenciales inválidas');
    }

    if (user.verificationToken) {
      throw new UnauthorizedException('El correo electrónico no ha sido verificado');
    }

    if (!user.active) {
      throw new UnauthorizedException('El usuario no está activo');
    }

    const passwordMatches = bcrypt.compareSync(dto.password, user.password);
    if (!passwordMatches) {
      throw new ForbiddenException('Credenciales inválidas');
    }

    const payload = {
      sub: user._id.toString(),
      dni: user.dni,
      role: user.role,
      active: user.active,
    };

    if (user.votingDepartmentId) {
      payload['votingDepartmentId'] = user.votingDepartmentId.toString();
    }
    
    if (user.votingMunicipalityId) {
      payload['votingMunicipalityId'] = user.votingMunicipalityId.toString();
    }
    
    const accessToken = await this.jwtService.signAsync(payload);

    return { accessToken, role: user.role, active: user.active };
  }

  async requestPasswordReset(dto: RequestPasswordResetDto): Promise<void> {
    const user = await this.roledUserModel.findOne({ email: dto.email });

    if (!user || !user.active) {
      return;
    }

    const resetToken = randomBytes(32).toString('hex');
    const resetTokenExpiresAt = new Date(
      Date.now() +
        1000 * 60 * 60 * this.configService.get<number>('app.mail.passwordResetTokenTTLHours', 2),
    );

    user.passwordResetToken = resetToken;
    user.passwordResetTokenExpiresAt = resetTokenExpiresAt;
    await user.save();

    await this.sendPasswordResetEmail(user.email, user.name, resetToken);
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const user = await this.roledUserModel.findOne({ passwordResetToken: dto.token });

    if (!user) {
      throw new BadRequestException('Token de restablecimiento inválido');
    }

    if (
      !user.passwordResetTokenExpiresAt ||
      user.passwordResetTokenExpiresAt.getTime() < Date.now()
    ) {
      throw new BadRequestException('El token de restablecimiento ha expirado');
    }

    user.password = bcrypt.hashSync(dto.password, 10);
    user.passwordResetToken = undefined;
    user.passwordResetTokenExpiresAt = undefined;

    await user.save();
  }

  private async sendVerificationEmail(to: string, name: string, token: string): Promise<void> {
    const verificationLink = this.buildEmailLink(token, 'app.mail.verificationBaseUrl');

    await this.mailService.sendEmail(to, 'Verificación de correo electrónico', 'verify-email', {
      name: name.split(' ')[0],
      verificationLink,
    });
  }

  private async sendPasswordResetEmail(to: string, name: string, token: string): Promise<void> {
    const resetLink = this.buildEmailLink(token, 'app.mail.passwordResetBaseUrl');

    await this.mailService.sendEmail(to, 'Restablecer contraseña', 'reset-password', {
      name: name.split(' ')[0],
      resetLink,
    });
  }

  private buildEmailLink(token: string, baseUrlEnvName: string): string | null {
    const baseUrl = this.configService.get<string>(baseUrlEnvName);

    if (!baseUrl) {
      throw new Error('Base URL no configurada');
    }

    try {
      const url = new URL(baseUrl);
      url.searchParams.set('token', token);
      return url.toString();
    } catch {
      const separator = baseUrl.includes('?') ? '&' : '?';
      return `${baseUrl}${separator}token=${token}`;
    }
  }

  async createRoledUser(dto: RegisterRoledUserDto): Promise<RoledUserDocument> {
    const payload: Partial<RoledUser> = {
      dni: dto.dni,
      email: dto.email,
      name: dto.name,
      password: bcrypt.hashSync(dto.password, 10),
      role: dto.votingDepartmentId ? 'GOVERNOR' : 'MAYOR',
      votingDepartmentId: dto.votingDepartmentId
        ? new Types.ObjectId(dto.votingDepartmentId)
        : null,
      votingMunicipalityId: dto.votingMunicipalityId
        ? new Types.ObjectId(dto.votingMunicipalityId)
        : null,
      active: true,
    };

    let user: RoledUserDocument | undefined;
    try {
      user = await this.roledUserModel.create(payload);
      return user;
    } catch (error: any) {
      if (error?.code === 11000) {
        throw new BadRequestException('Usuario ya registrado para el DNI o correo electrónico proporcionado');
      }
      throw error;
    }
  }

  async deleteRoledUserByEmail(email: string): Promise<void> {
    await this.roledUserModel.deleteOne({ email });
  }
}
