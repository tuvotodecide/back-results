import { Controller, Get, Param, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody } from '@nestjs/swagger';
import { UsersService } from '../services/users.service';
import { RegisterUserByDniDto, UserResponseDto } from '../dto/users.dto';

@ApiTags('Users')
@Controller('api/v1/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registrar un usuario por DNI' })
  @ApiBody({
    schema: {
      properties: { dni: { type: 'string', example: '12345678' } },
      required: ['dni'],
    },
  })
  @ApiResponse({ status: 201, description: 'Usuario creado o existente', type: UserResponseDto })
  async register(@Body() body: RegisterUserByDniDto) {
    const user = await this.usersService.findOrCreateByDni(body.dni);
    return {
      _id: user._id.toString(),
      dni: user.dni,
      active: user.active,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  @Get(':dni')
  @ApiOperation({ summary: 'Obtener usuario por DNI' })
  @ApiParam({ name: 'dni' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  async getByDni(@Param('dni') dni: string) {
    const user = await this.usersService.findByDni(dni);
    return {
      _id: user._id.toString(),
      dni: user.dni,
      active: user.active,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
