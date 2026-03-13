// src/modules/mocks/controllers/testing.controller.ts
import {
  Controller,
  Post,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { TestingSeederService } from '../services/testing-seeder.service';
import { Public } from '../../../core/decorators/public.decorator';

@ApiTags('Testing')
@Controller('testing')
export class TestingController {
  constructor(private readonly seederService: TestingSeederService) {}

  @Post('seed')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Seed datos de prueba para e2e testing',
    description: `
      Crea datos mock COMPLETOS para testing frontend E2E:

      ## Elecciones y Resultados
      - 2 elecciones (departamental para gobernadores, municipal para alcaldes)
      - 4 partidos políticos de prueba (Azul, Rojo, Verde, Amarillo)
      - 24 ballots con resultados (4 ubicaciones × 3 mesas × 2 elecciones)
      - 24 AttestationCases marcados como CONSENSUAL

      ## Usuarios Candidatos (login con contrato)
      - gobernador.lapaz@test.local (GOVERNOR - La Paz)
      - gobernador.cochabamba@test.local (GOVERNOR - Cochabamba)
      - alcalde.lapaz@test.local (MAYOR - La Paz)
      - alcalde.cochabamba@test.local (MAYOR - Cochabamba)
      - Contraseña para todos: test1234

      ## Delegados y Atestiguamiento
      - 12 delegados de prueba (distribuidos entre los 4 candidatos)
      - 2 delegados multi-contrato (trabajan para varios candidatos)
      - Attestations (votos de delegados) sobre los ballots
      - Jurados de mesa (1-2 por ballot)

      ## Ubicaciones con Datos
      - La Paz → Murillo → La Paz (3 mesas)
      - La Paz → Murillo → El Alto (3 mesas)
      - Cochabamba → Cercado → Cochabamba (3 mesas)
      - Santa Cruz → Andres Ibañez → Santa Cruz (3 mesas)

      Todos los datos tienen prefijo "TEST_E2E_" para fácil identificación.
      Idempotente: ejecutar múltiples veces actualiza los datos existentes.
    `,
  })
  @ApiResponse({
    status: 201,
    description: 'Datos de prueba creados exitosamente',
  })
  async seedTestData() {
    const result = await this.seederService.seedAll();

    return {
      success: true,
      message: 'Datos de prueba creados',
      data: {
        elections: result.elections.map((e: any) => ({
          id: e._id,
          name: e.name,
          type: e.type,
        })),
        partiesCount: result.parties.length,
        ballots: result.ballots.map((b: any) => ({
          id: b._id,
          tableCode: b.tableCode,
          tableNumber: b.tableNumber,
          electionId: b.electionId,
        })),
        attestationCasesCount: result.attestationCases.length,
        users: result.users.map((u: any) => ({
          id: u._id,
          email: u.email,
          name: u.name,
          role: u.role,
          password: 'test1234',
        })),
        contractsCount: result.contracts.length,
        delegates: result.delegates.map((d: any) => ({
          id: d._id,
          dni: d.dni,
          name: d.name,
          email: d.email,
          contractsCount: d.authorizedContracts?.length || 0,
        })),
        delegateUsersCount: result.delegateUsers.length,
        attestationsCount: result.attestations.length,
      },
    };
  }

  @Post('seed-audit-demo')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Seed específico para demo de auditoría TSE',
    description: `
      Crea una demo mínima y reutilizable para probar el flujo completo de auditoría:

      - 1 usuario ADMIN para ejecutar la comparación masiva
      - 1 usuario GOVERNOR con contrato activo para iniciar sesión y ver reportes
      - 1 delegado autorizado
      - 2 actas atestiguadas: mesa 2010701 y mesa 2010691
      - Mesa 2010701 preparada para MATCH con el OEP/TSE
      - Mesa 2010691 preparada para MISMATCH con el OEP/TSE
      - Elección activa y ya en período de resultados
    `,
  })
  @ApiResponse({
    status: 201,
    description: 'Demo de auditoría creada exitosamente',
  })
  async seedAuditDemo() {
    const result = await this.seederService.seedAuditDemo();

    return {
      success: true,
      message: 'Demo de auditoría creada',
      data: {
        election: {
          id: result.election._id,
          name: result.election.name,
          type: result.election.type,
        },
        admin: {
          email: result.admin.email,
          password: 'audit1234',
          role: result.admin.role,
        },
        client: {
          email: result.client.email,
          password: 'audit1234',
          role: result.client.role,
        },
        delegate: {
          dni: result.delegate.dni,
          name: result.delegate.name,
        },
        contract: {
          id: result.contract._id,
        },
        ballots: result.ballots.map((b: any) => ({
          id: b._id,
          tableCode: b.tableCode,
          tableNumber: b.tableNumber,
        })),
      },
    };
  }

  @Delete('cleanup')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Eliminar todos los datos de prueba',
    description: `
      Elimina todos los datos creados por el endpoint /seed.
      Solo elimina datos con prefijo "TEST_E2E_".
      Seguro de ejecutar: no afecta datos reales.
    `,
  })
  @ApiResponse({
    status: 200,
    description: 'Datos de prueba eliminados',
    schema: {
      example: {
        success: true,
        message: 'Datos de prueba eliminados',
        deleted: {
          elections: 2,
          ballots: 24,
          attestationCases: 24,
          attestations: 100,
          parties: 4,
          electionParties: 8,
          users: 4,
          contracts: 4,
          delegateUsers: 12,
          delegates: 12,
        },
      },
    },
  })
  async cleanupTestData() {
    const result = await this.seederService.cleanupAll();

    return {
      success: true,
      message: 'Datos de prueba eliminados',
      deleted: {
        elections: result.deletedElections,
        ballots: result.deletedBallots,
        attestationCases: result.deletedAttestationCases,
        attestations: result.deletedAttestations,
        parties: result.deletedParties,
        electionParties: result.deletedElectionParties,
        users: result.deletedUsers,
        contracts: result.deletedContracts,
        delegateUsers: result.deletedDelegateUsers,
        delegates: result.deletedDelegates,
        electoralTables: result.deletedElectoralTables,
        electoralLocations: result.deletedElectoralLocations,
        electoralSeats: result.deletedElectoralSeats,
      },
    };
  }

  @Get('stats')
  @Public()
  @ApiOperation({
    summary: 'Estadísticas de datos de prueba existentes',
    description: 'Muestra cuántos datos de prueba existen actualmente en la base de datos.',
  })
  @ApiResponse({
    status: 200,
    description: 'Estadísticas obtenidas',
    schema: {
      example: {
        success: true,
        stats: {
          elections: 2,
          ballots: 24,
          attestationCases: 24,
          parties: 4,
        },
      },
    },
  })
  async getTestDataStats() {
    const stats = await this.seederService.getTestDataStats();

    return {
      success: true,
      stats,
    };
  }
}
