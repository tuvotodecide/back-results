import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { HistoryService } from '../services/history.service';
import { CreateHistoryDto } from '../dto/create-history.dto';
import { FindHistoryDto } from '../dto/find-history.dto';
import { Public } from '@/core/decorators/public.decorator';
import { JwtOrApiKeyGuard } from '@/core/guards/jwt-or-api-key.guard';

@Public()
@UseGuards(JwtOrApiKeyGuard)
@Controller('api/v1/history')
export class HistoryController {
  constructor(private readonly historyService: HistoryService) {}

  @Post()
  create(@Body() createHistoryDto: CreateHistoryDto) {
    return this.historyService.create(createHistoryDto);
  }

  @Get()
  findAll(@Query() query: FindHistoryDto) {
    return this.historyService.findAll(query);
  }

  @Get('contracts')
  getContractsData() {
    return this.historyService.getContracts();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.historyService.findOne(id);
  }
}
