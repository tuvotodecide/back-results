import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '@/core/decorators/public.decorator';
import { ZkAuthGuard } from '@/core/guards/zk-auth.guard';
import { VotingPeriodGuard } from '@/modules/elections/guards/voting-period.guard';
import {
  CompareWorksheetDto,
  CompareWorksheetResponseDto,
  CreateWorksheetFromIpfsDto,
  RetryWorksheetFromIpfsDto,
  WorksheetStatusResponseDto,
} from '../dto/worksheet.dto';
import { WorksheetService } from '../services/worksheet.service';

@ApiTags('Worksheets')
@Controller('api/v1/worksheets')
export class WorksheetController {
  constructor(private readonly worksheetService: WorksheetService) {}

  @Post('from-ipfs')
  @Public()
  @UseGuards(VotingPeriodGuard, ZkAuthGuard)
  @ApiOperation({
    summary: 'Registrar hoja de trabajo privada desde IPFS',
  })
  @ApiBody({ type: CreateWorksheetFromIpfsDto })
  @ApiResponse({
    status: 201,
    description: 'Hoja de trabajo registrada',
    type: WorksheetStatusResponseDto,
  })
  createFromIpfs(@Body() dto: CreateWorksheetFromIpfsDto) {
    return this.worksheetService.createFromIpfs(dto);
  }

  @Post('retry')
  @Public()
  @UseGuards(VotingPeriodGuard, ZkAuthGuard)
  @ApiOperation({
    summary: 'Reintentar subida de hoja de trabajo fallida',
  })
  @ApiBody({ type: RetryWorksheetFromIpfsDto })
  @ApiResponse({
    status: 200,
    description: 'Reintento procesado',
    type: WorksheetStatusResponseDto,
  })
  retryFromIpfs(@Body() dto: RetryWorksheetFromIpfsDto) {
    return this.worksheetService.retryFailedFromIpfs(dto);
  }

  @Get(':dni/by-table/:tableCode')
  @Public()
  @UseGuards(ZkAuthGuard)
  @ApiOperation({
    summary: 'Consultar estado de hoja de trabajo por usuario/mesa/elección',
  })
  @ApiParam({ name: 'dni' })
  @ApiParam({ name: 'tableCode' })
  @ApiQuery({ name: 'electionId', required: true })
  @ApiResponse({
    status: 200,
    description: 'Estado de hoja encontrado o NOT_FOUND',
    type: WorksheetStatusResponseDto,
  })
  async getStatusByTable(
    @Param('dni') dni: string,
    @Param('tableCode') tableCode: string,
    @Query('electionId') electionId: string,
  ): Promise<any> {
    const worksheet = await this.worksheetService.getStatusByTable(
      dni,
      electionId,
      tableCode,
    );

    if (!worksheet) {
      return {
        status: 'NOT_FOUND',
      };
    }

    return {
      id: String((worksheet as any)._id),
      status: worksheet.status,
      tableCode: worksheet.tableCode,
      tableNumber: worksheet.tableNumber,
      ipfsUri: worksheet.ipfsUri,
      nftLink: worksheet.nftLink,
      errorMessage: worksheet.errorMessage,
    };
  }

  @Post('compare')
  @Public()
  @UseGuards(ZkAuthGuard)
  @ApiOperation({
    summary:
      'Comparar resultados del acta oficial contra hoja de trabajo privada del usuario',
  })
  @ApiBody({ type: CompareWorksheetDto })
  @ApiResponse({
    status: 200,
    description:
      'Devuelve MATCH/MISMATCH/NOT_AVAILABLE/NOT_FOUND sin bloquear el flujo',
    type: CompareWorksheetResponseDto,
  })
  compare(@Body() dto: CompareWorksheetDto) {
    return this.worksheetService.compareAgainstWorksheet(dto);
  }
}
