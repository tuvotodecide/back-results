import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from '../services/auth.service';
import {
  RegisterRoledUserDto,
  RoledUserResponseDto,
} from '../dto/register-roled-user.dto';
import { ProfileResponseDto, SignInDto, SignInResponseDto } from '../dto/sign-in.dto';
import { MessageResponseDto, RequestPasswordResetDto, ResetPasswordDto } from '../dto/password-reset.dto';
import { RoledUserDocument } from '../schemas/roledUser.schema';
import { Public } from '@/core/decorators/public.decorator';
import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';
import { VerifyEmailDto } from '../dto/verify-email.dto';
import { JwtAuthGuard } from '@/core/guards/jwt-auth.guard';

@ApiTags('Auth')
@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registrar un usuario con rol' })
  @ApiBody({ type: RegisterRoledUserDto })
  @ApiResponse({ status: 201, type: RoledUserResponseDto })
  async register(
    @Body() dto: RegisterRoledUserDto,
  ): Promise<RoledUserResponseDto> {
    const user = await this.authService.register(dto);
    return this.toResponse(user);
  }

  @Get('verify-email')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verificar el correo electrónico de un usuario' })
  @ApiQuery({ name: 'token', required: true, description: 'Token de verificación enviado por correo electrónico' })
  @ApiResponse({ status: 200, type: RoledUserResponseDto })
  async verifyEmail(@Query() query: VerifyEmailDto): Promise<RoledUserResponseDto> {
    const user = await this.authService.verifyEmail(query.token);
    return this.toResponse(user);
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Iniciar sesión de un usuario' })
  @ApiResponse({ status: 200, type: SignInResponseDto })
  async signIn(@Body() signInDto: SignInDto): Promise<SignInResponseDto> {
    return this.authService.signIn(signInDto);
  }

  @Post('forgot-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Solicitar restablecimiento de contraseña por correo' })
  @ApiBody({ type: RequestPasswordResetDto })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  async requestPasswordReset(@Body() dto: RequestPasswordResetDto): Promise<MessageResponseDto> {
    await this.authService.requestPasswordReset(dto);
    return {
      message: 'Si el correo está registrado, se enviaron instrucciones para restablecer la contraseña',
    };
  }

  @Post('reset-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restablecer contraseña con token enviado por correo' })
  @ApiBody({ type: ResetPasswordDto })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<MessageResponseDto> {
    await this.authService.resetPassword(dto);
    return { message: 'Contraseña actualizada correctamente' };
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Obtener el perfil del usuario autenticado' })
  @ApiResponse({ status: 200, type: ProfileResponseDto })
  getProfile(@Request() req) {
    return req.user;
  }

  @Post('test/roleduser')
  @UseGuards(AdminOnlyGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registrar un usuario de prueba activo' })
  @ApiBody({ type: RegisterRoledUserDto })
  @ApiResponse({ status: 201, type: RoledUserResponseDto })
  async createRoleUser(
    @Body() dto: RegisterRoledUserDto,
  ): Promise<RoledUserResponseDto> {
    const user = await this.authService.createRoledUser(dto);
    return this.toResponse(user);
  }

  @Delete('test/roleduser/:email')
  @UseGuards(AdminOnlyGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar un usuario de prueba por correo electrónico' })
  @ApiParam({ name: 'email', required: true, description: 'Correo electrónico del usuario a eliminar' })
  @ApiResponse({ status: 204 })
  async deleteRoleUser(@Param('email') email: string): Promise<void> {
    await this.authService.deleteRoledUserByEmail(email);
  }

  private toResponse(user: RoledUserDocument): RoledUserResponseDto {
    return {
      _id: user._id.toString(),
      dni: user.dni,
      email: user.email,
      name: user.name,
      role: user.role,
      active: user.active,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      votingDepartmentId: user.votingDepartmentId
        ? (user.votingDepartmentId as any).toString()
        : null,
      votingMunicipalityId: user.votingMunicipalityId
        ? (user.votingMunicipalityId as any).toString()
        : null,
    };
  }
}
