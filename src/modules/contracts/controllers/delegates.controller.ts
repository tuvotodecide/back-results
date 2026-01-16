// src/modules/contracts/controllers/delegates.controller.ts
import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { DelegatesService } from '../services/delegates.service';
import {
  UploadDelegatesCsvDto,
  AddDelegateDto,
  RemoveDelegateDto,
} from '../dto/delegates.dto';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';

@ApiTags('Delegates')
@Controller('api/v1/delegates')
export class DelegatesController {
  constructor(private readonly delegatesService: DelegatesService) {}


  @Post('upload-csv')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cargar lista oficial de delegados desde CSV (Superadmin)',
    description:
      'Permite al Superadmin cargar masivamente la lista de delegados autorizados para un contrato. Formato CSV: dni,name,phone,email',
  })
  @ApiResponse({
    status: 201,
    description: 'Delegados cargados exitosamente',
    schema: {
      properties: {
        added: { type: 'number' },
        updated: { type: 'number' },
        errors: { type: 'array' },
      },
    },
  })
  async uploadCsv(@Body() dto: UploadDelegatesCsvDto, @Request() req: any) {
    // req.user.sub contiene el ID del usuario autenticado (Superadmin)
    const superadminId = req.user.sub;

    const result = await this.delegatesService.uploadDelegatesCsv({
      csvContent: dto.csvContent,
      contractId: dto.contractId,
      superadminId,
    });

    return {
      message: 'Carga completada',
      summary: {
        added: result.added,
        updated: result.updated,
        totalErrors: result.errors.length,
      },
      errors: result.errors,
    };
  }

  /**
   * Agregar un delegado manualmente
   */
  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Agregar un delegado manualmente (Superadmin)',
  })
  @ApiResponse({ status: 201, description: 'Delegado agregado exitosamente' })
  async add(@Body() dto: AddDelegateDto, @Request() req: any) {
    const delegate = await this.delegatesService.addDelegate({
      dni: dto.dni,
      contractId: dto.contractId,
      superadminId: req.user.sub,
      name: dto.name,
      phone: dto.phone,
      email: dto.email,
    });

    return {
      id: delegate._id.toString(),
      dni: delegate.dni,
      name: delegate.name,
      authorizedContracts: delegate.authorizedContracts.map((ac) => ({
        contractId: ac.contractId.toString(),
        clientRole: ac.clientRole,
        addedAt: ac.addedAt,
      })),
    };
  }

  /**
   * Listar delegados de un contrato
   */
  @Get('contract/:contractId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar delegados de un contrato' })
  @ApiResponse({
    status: 200,
    description: 'Lista de delegados',
  })
  async listByContract(@Param('contractId') contractId: string) {
    const delegates = await this.delegatesService.listByContract(contractId);

    return {
      data: delegates.map((d) => ({
        id: d._id.toString(),
        dni: d.dni,
        userId: d.userId.toString(),
        name: d.name,
        phone: d.phone,
        email: d.email,
        active: d.active,
        contracts: d.authorizedContracts
          .filter((ac) => ac.contractId.toString() === contractId)
          .map((ac) => ({
            clientRole: ac.clientRole,
            addedAt: ac.addedAt,
          })),
      })),
      total: delegates.length,
    };
  }

  /**
   * Verificar autorización de un DNI
   */
  @Get('check-authorization')
  @ApiOperation({
    summary: 'Verificar si un DNI está autorizado para un contrato',
    description:
      'Usado para validar que un atestiguamiento proviene de un delegado oficial',
  })
  @ApiResponse({
    status: 200,
    schema: {
      properties: {
        isAuthorized: { type: 'boolean' },
        contracts: { type: 'array' },
      },
    },
  })
  async checkAuthorization(
    @Query('dni') dni: string,
    @Query('contractId') contractId?: string,
  ) {
    if (contractId) {
      const isAuthorized =
        await this.delegatesService.isAuthorizedForContract(dni, contractId);
      return { isAuthorized, contractId };
    }

    // Sin contractId, devolver todos los contratos del delegado
    const contracts =
      await this.delegatesService.getAuthorizedContracts(dni);
    return {
      isAuthorized: contracts.length > 0,
      contracts,
    };
  }

  /**
   * Remover un delegado de un contrato
   */
  @Delete()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Remover un delegado de un contrato (Superadmin)',
  })
  @ApiResponse({
    status: 200,
    description: 'Delegado removido del contrato',
  })
  async remove(@Body() dto: RemoveDelegateDto) {
    await this.delegatesService.removeFromContract(dto.dni, dto.contractId);
    return {
      message: 'Delegado removido del contrato exitosamente',
    };
  }

  /**
   * Obtener contratos autorizados para un DNI
   * Útil para el caso 3.1 (delegado multi-contrato)
   */
  @Get('authorized-contracts/:dni')
  @ApiOperation({
    summary: 'Obtener contratos autorizados para un delegado',
    description:
      'Devuelve la lista de contratos para los que un delegado está autorizado (multi-contrato)',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de contratos autorizados',
  })
  async getAuthorizedContracts(@Param('dni') dni: string) {
    const contracts =
      await this.delegatesService.getAuthorizedContracts(dni);

    return {
      dni,
      contracts,
      count: contracts.length,
    };
  }
}