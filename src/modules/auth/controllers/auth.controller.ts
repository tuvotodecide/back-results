import { Body, Controller, Get, HttpCode, HttpStatus, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from '../services/auth.service';
import {
  RegisterRoledUserDto,
  RoledUserResponseDto,
} from '../dto/register-roled-user.dto';
import { JwtAuthGuard } from '@/core/guards/jwt-auth.guard';
import { ProfileResponseDto, SignInDto, SignInResponseDto } from '../dto/sign-in.dto';

@ApiTags('Auth')
@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registrar un usuario con rol' })
  @ApiBody({ type: RegisterRoledUserDto })
  @ApiResponse({ status: 201, type: RoledUserResponseDto })
  async register(
    @Body() dto: RegisterRoledUserDto,
  ): Promise<RoledUserResponseDto> {
    const user = await this.authService.register(dto);

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

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Iniciar sesión de un usuario' })
  @ApiResponse({ status: 200, type: SignInResponseDto })
  async signIn(@Body() signInDto: SignInDto): Promise<SignInResponseDto> {
    return this.authService.signIn(signInDto);
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Obtener el perfil del usuario autenticado' })
  @ApiResponse({ status: 200, type: ProfileResponseDto })
  getProfile(@Request() req) {
    return req.user;
  }
}
