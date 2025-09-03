import {
  Controller,
  Get,
  Param,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Patch,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { UsersService } from '../services/users.service';
import { RegisterUserByDniDto, UserResponseDto } from '../dto/users.dto';
import {
  UpdateVotePlaceDto,
  VotePlaceResponseDto,
} from '../dto/update-vote-place.dto';

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
  @ApiResponse({
    status: 201,
    description: 'Usuario creado o existente',
    type: UserResponseDto,
  })
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

  @Patch(':dni/vote-place')
  @ApiOperation({
    summary: 'Guardar/editar recinto y/o mesa de votación para un DNI',
    description:
      'Permite editar parcialmente: solo locationId, solo tableId/tableCode o ambos. Si cambias de recinto y la mesa anterior no pertenece al nuevo recinto, la mesa se borra.',
  })
  @ApiParam({ name: 'dni' })
  @ApiBody({ type: UpdateVotePlaceDto })
  @ApiResponse({ status: 200, type: VotePlaceResponseDto })
  updateVotePlace(
    @Param('dni') dni: string,
    @Body() dto: UpdateVotePlaceDto,
  ): Promise<VotePlaceResponseDto> {
    return this.usersService.updateVotePlaceByDni(dni, dto);
  }

  @Get(':dni/vote-place')
  @ApiOperation({
    summary: 'Obtener recinto/mesa de votación del usuario por DNI',
  })
  @ApiParam({ name: 'dni' })
  @ApiResponse({ status: 200, type: VotePlaceResponseDto })
  getVotePlace(@Param('dni') dni: string): Promise<VotePlaceResponseDto> {
    return this.usersService.getVotePlaceByDni(dni);
  }
}
