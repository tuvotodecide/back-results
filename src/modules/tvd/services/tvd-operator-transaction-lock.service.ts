import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  TvdOperatorTransactionLock,
  TvdOperatorTransactionLockDocument,
} from '../schemas/tvd-operator-transaction-lock.schema';

@Injectable()
export class TvdOperatorTransactionLockService {
  constructor(
    @InjectModel(TvdOperatorTransactionLock.name)
    private readonly lockModel: Model<TvdOperatorTransactionLockDocument>,
  ) {}

  buildLockKey(input: { chainId: number; operatorAddress: string }) {
    return `${input.chainId}:${input.operatorAddress.toLowerCase()}`;
  }

  async acquire(input: {
    lockKey: string;
    ownerId: string;
    ttlMs: number;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const expiresAt = new Date(now.getTime() + input.ttlMs);
    try {
      const lock = await this.lockModel.findOneAndUpdate(
        {
          lockKey: input.lockKey,
          $or: [
            { expiresAt: { $lte: now } },
            { expiresAt: { $exists: false } },
            { ownerId: input.ownerId },
          ],
        },
        {
          $set: {
            lockKey: input.lockKey,
            ownerId: input.ownerId,
            acquiredAt: now,
            expiresAt,
          },
        },
        {
          upsert: true,
          returnDocument: 'after',
          setDefaultsOnInsert: true,
        },
      );
      return lock?.ownerId === input.ownerId ? lock : null;
    } catch (error: any) {
      if (error?.code === 11000) return null;
      throw error;
    }
  }

  async renew(input: {
    lockKey: string;
    ownerId: string;
    ttlMs: number;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    return this.lockModel.findOneAndUpdate(
      { lockKey: input.lockKey, ownerId: input.ownerId },
      {
        $set: {
          expiresAt: new Date(now.getTime() + input.ttlMs),
        },
      },
      { returnDocument: 'after' },
    );
  }

  async release(input: { lockKey: string; ownerId: string }) {
    await this.lockModel.deleteOne({
      lockKey: input.lockKey,
      ownerId: input.ownerId,
    });
  }
}
