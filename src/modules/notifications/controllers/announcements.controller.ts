import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TopicMessagingService } from '../services/topic-messaging.service';
import { ElectoralLocation } from '@/modules/geographic/schemas/electoral-location.schema';
import { ElectoralLocationService } from '@/modules/geographic/services/electoral-location.service';
import { ElectoralTableService } from '@/modules/geographic/services/electoral-table.service';
import { AnnounceCountDto } from '../dto/annunce.dto';

@ApiTags('Announcements')
@Controller('api/v1/announcements')
export class AnnouncementsController {
  constructor(
    private readonly topics: TopicMessagingService,
    private readonly locations: ElectoralLocationService,
    private readonly tables: ElectoralTableService,
  ) {}
  @Post('count')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Anunciar conteo al topic del recinto (loc_<locationId>)',
  })
  async announce(@Body() dto: AnnounceCountDto) {
    const location = await this.locations.resolveByIdOrCode({
      locationId: (dto.locationId ?? '').trim() || undefined,
      locationCode: (dto.locationCode ?? '').trim() || undefined,
    });

    let table: any = null;
    if (dto.tableId || dto.tableCode) {
      table = await this.tables.resolveByIdOrCode({
        tableId: dto.tableId,
        tableCode: dto.tableCode,
      });

      const tblLocId = String(
        table.electoralLocationId?._id ??
          table.electoralLocationId ??
          table.electoralLocation?._id,
      );
      if (tblLocId !== String(location._id)) {
        return { success: false, error: 'La mesa no pertenece al recinto' };
      }
    }

    const res = await this.topics.announceCountToLocation({
      locationId: String(location._id),
      locationName: location.name,
      locationAddress: location.address,
      tableId: table?._id ? String(table._id) : dto.tableId,
      tableNumber: table?.tableNumber ?? undefined,
      tableCode: table?.tableCode ?? dto.tableCode ?? undefined,
      title: dto.title,
      body: dto.body,
    });

    return { success: true, result: res };
  }
}
