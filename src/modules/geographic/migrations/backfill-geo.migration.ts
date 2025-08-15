/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ElectoralLocation,
  ElectoralLocationDocument,
} from '../schemas/electoral-location.schema';

@Injectable()
export class BackfillGeoMigration implements OnApplicationBootstrap {
  private readonly logger = new Logger(BackfillGeoMigration.name);

  constructor(
    @InjectModel(ElectoralLocation.name)
    private readonly locationModel: Model<ElectoralLocationDocument>,
  ) {}

  async onApplicationBootstrap() {
    if (process.env.RUN_BACKFILL_GEO !== '1') return;

    this.logger.warn('Iniciando BACKFILL_GEO...');
    await this.ensureIndex();
    const total = await this.runBackfill();
    this.logger.warn(
      `BACKFILL_GEO terminado. Documentos actualizados: ${total}`,
    );
  }

  private async ensureIndex() {
    await this.locationModel.collection.createIndex({ geo: '2dsphere' });
  }

  private async runBackfill() {
    const cursor = this.locationModel
      .find({
        geo: { $exists: false },
        'coordinates.latitude': { $exists: true },
        'coordinates.longitude': { $exists: true },
      })
      .select({ coordinates: 1 })
      .lean()
      .cursor();

    let updated = 0;
    const batch: any[] = [];
    const BATCH_SIZE = 500;

    for await (const doc of cursor as any) {
      const lat = doc.coordinates?.latitude;
      const lng = doc.coordinates?.longitude;
      if (typeof lat === 'number' && typeof lng === 'number') {
        batch.push({
          updateOne: {
            filter: { _id: doc._id },
            update: {
              $set: { geo: { type: 'Point', coordinates: [lng, lat] } },
            },
          },
        });
      }
      if (batch.length >= BATCH_SIZE) {
        const res = await this.locationModel.bulkWrite(batch, {
          ordered: false,
        });
        updated += res.modifiedCount ?? 0;
        batch.length = 0;
      }
    }

    if (batch.length) {
      const res = await this.locationModel.bulkWrite(batch, { ordered: false });
      updated += res.modifiedCount ?? 0;
    }

    return updated;
  }
}
