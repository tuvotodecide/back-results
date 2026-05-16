// locks.services.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

type LockDoc = { _id: string; owner: string; expiresAt: Date };

@Injectable()
export class LocksService {
  private readonly logger = new Logger(LocksService.name);

  constructor(@InjectModel('Lock') private readonly lockModel: Model<LockDoc>) {
    // Garantiza el TTL al iniciar (idempotente)
    this.lockModel.collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {});
  }

  async tryAcquire(key: string, owner: string, ttlSeconds: number): Promise<boolean> {
    const now = new Date();
    const newExp = new Date(now.getTime() + ttlSeconds * 1000);

    // Toma el lock si:
    // - no existe
    // - está vencido (expiresAt <= now)
    // - o ya es tuyo (misma owner) → reentrada/renovación
    const res = await this.lockModel.findOneAndUpdate(
      {
        _id: key,
        $or: [
          { expiresAt: { $lte: now } },
          { owner },
          { _id: { $exists: false } },
        ],
      },
      { $set: { owner, expiresAt: newExp } },
      { upsert: true, returnDocument: 'after' },
    ).lean<LockDoc>().exec().catch((e) => {
      this.logger.warn(`tryAcquire failed (${key}): ${String(e)}`);
      return null;
    });

    return !!res && res.owner === owner;
  }

  async release(key: string, owner: string): Promise<void> {
    await this.lockModel.deleteOne({ _id: key, owner }).catch(() => {});
  }

  // (opcional) ayudita para debug
  async peek(key: string): Promise<LockDoc | null> {
    return this.lockModel.findOne({ _id: key }).lean<LockDoc>().exec();
  }
}
