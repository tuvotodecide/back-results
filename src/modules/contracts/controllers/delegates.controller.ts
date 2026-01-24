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
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { DelegatesService } from '../services/delegates.service';
import { AddDelegateDto, RemoveDelegateDto } from '../dto/delegates.dto';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';
import { Multer } from 'multer';

@ApiTags('Delegates')
@Controller('api/v1/delegates')
export class DelegatesController {
  constructor(private readonly delegatesService: DelegatesService) {}

  @Post('upload-csv')
  @ApiBearerAuth()
  @UseGuards(AdminOnlyGuard)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Cargar lista oficial de delegados desde archivo CSV (Superadmin)',
    description:
      'Permite al Superadmin cargar masivamente la lista de delegados autorizados para un contrato. Formato CSV: dni,name,phone,email',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'contractId'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Archivo CSV con formato: dni,name,phone,email',
        },
        contractId: {
          type: 'string',
          description: 'ID del contrato',
        },
      },
    },
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
  async uploadCsv(
    @UploadedFile() file: Multer.File,
    @Body('contractId') contractId: string,
    @Request() req: any,
  ) {
    if (!file) {
      throw new BadRequestException('Debe proporcionar un archivo CSV');
    }

    if (!contractId) {
      throw new BadRequestException('Debe proporcionar el contractId');
    }

    // Convertir el buffer del archivo a string
    const csvContent = file.buffer.toString('utf-8');

    const superadminId = req.user.sub;

    const result = await this.delegatesService.uploadDelegatesCsv({
      csvContent,
      contractId,
      superadminId,
    });

    return {
      message: 'Carga completada',
      fileName: file.originalname,
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
  @ApiBearerAuth()
  @UseGuards(AdminOnlyGuard)
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
  @UseGuards(JwtAuthGuard, AdminOnlyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar delegados de un contrato' })
  @ApiResponse({
    status: 200,
    description: 'Lista de delegados',
  })
  async listByContract(@Param('contractId') contractId: string) {
    const delegates = await this.delegatesService.listByContract(contractId);

    return {
      data: delegates.map((d) => {
        // Después del populate, userId es un objeto, no ObjectId
        const user = d.userId as any;

        return {
          id: d._id.toString(),
          dni: d.dni,
          userId: user?._id?.toString() || user?.toString(),
          user: user?._id
            ? {
                dni: user.dni,
                votingLocationId: user.votingLocationId?.toString() || null,
                votingTableId: user.votingTableId?.toString() || null,
              }
            : undefined,
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
        };
      }),
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
      const isAuthorized = await this.delegatesService.isAuthorizedForContract(
        dni,
        contractId,
      );
      return { isAuthorized, contractId };
    }

    // Sin contractId, devolver todos los contratos del delegado
    const contracts = await this.delegatesService.getAuthorizedContracts(dni);
    return {
      isAuthorized: contracts.length > 0,
      contracts,
    };
  }

  /**
   * Remover un delegado de un contrato
   */
  @Delete()
  @ApiBearerAuth()
  @UseGuards(AdminOnlyGuard)
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
    const contracts = await this.delegatesService.getAuthorizedContracts(dni);

    return {
      dni,
      contracts,
      count: contracts.length,
    };
  }
}
