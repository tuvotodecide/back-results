import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  LiveEffectiveBallot,
  LiveEffectiveBallotDocument,
} from '../schemas/live-effective-ballot.schema';
import {
  LiveProjectionMeta,
  LiveProjectionMetaDocument,
} from '../schemas/live-projection-meta.schema';

type LiveProjectionMetaLean = {
  electionId: Types.ObjectId;
  totalTables: number;
  projectionVersion: number;
  projectionUpdatedAt: Date;
};

@Injectable()
export class LiveProjectionService {
  private readonly logger = new Logger(LiveProjectionService.name);
  private readonly refreshMs = Number(
    process.env.LS || '30000',
  );
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    @InjectModel(LiveEffectiveBallot.name)
    private readonly liveEffectiveBallotModel: Model<LiveEffectiveBallotDocument>,
    @InjectModel(LiveProjectionMeta.name)
    private readonly liveProjectionMetaModel: Model<LiveProjectionMetaDocument>,
  ) {}

  async ensureProjection(electionId: string): Promise<void> {
    const eid = new Types.ObjectId(electionId);
    const meta = await this.liveProjectionMetaModel
      .findOne({ electionId: eid })
      .select({ projectionUpdatedAt: 1 })
      .lean();
    const latest = await this.liveEffectiveBallotModel
      .findOne({ electionId: eid })
      .sort({ projectionUpdatedAt: -1 })
      .select({ projectionUpdatedAt: 1 })
      .lean();

    if (!latest || !meta) {
      await this.rebuildProjection(electionId);
      return;
    }

    const ageMs = Date.now() - new Date(latest.projectionUpdatedAt).getTime();
    if (ageMs > this.refreshMs) {
      void this.rebuildProjection(electionId);
    }
  }

  async rebuildProjection(electionId: string): Promise<void> {
    const existing = this.inFlight.get(electionId);
    if (existing) return existing;

    const run = this.rebuildProjectionInternal(electionId).finally(() => {
      this.inFlight.delete(electionId);
    });
    this.inFlight.set(electionId, run);
    return run;
  }

  async getMeta(electionId: string): Promise<LiveProjectionMetaLean | null> {
    return this.liveProjectionMetaModel
      .findOne({ electionId: new Types.ObjectId(electionId) })
      .lean<LiveProjectionMetaLean>();
  }

  private async rebuildProjectionInternal(electionId: string): Promise<void> {
    const eid = new Types.ObjectId(electionId);
    const projectionVersion = Date.now();
    const projectionUpdatedAt = new Date();
    const observedKey = String(electionId);

    const observedExpr = {
      $ifNull: [
        {
          $first: {
            $map: {
              input: {
                $filter: {
                  input: { $objectToArray: '$table.observedByElection' },
                  as: 'kv',
                  cond: { $eq: ['$$kv.k', '$observedKey'] },
                },
              },
              as: 'kv2',
              in: '$$kv2.v',
            },
          },
        },
        false,
      ],
    };

    await this.liveEffectiveBallotModel.db
      .collection('ballots')
      .aggregate(
        [
          { $match: { electionId: eid, status: { $in: ['processed', 'synced'] } } },
          { $sort: { createdAt: -1, version: -1 } },
          {
            $group: {
              _id: '$tableCode',
              countVersions: { $sum: 1 },
              doc: { $first: '$$ROOT' },
            },
          },
          { $match: { countVersions: 1 } },
          { $replaceRoot: { newRoot: '$doc' } },
          {
            $lookup: {
              from: 'electoral_tables',
              localField: 'tableCode',
              foreignField: 'tableCode',
              as: 'table',
            },
          },
          { $addFields: { table: { $arrayElemAt: ['$table', 0] } } },
          { $addFields: { observedKey: { $toString: '$electionId' } } },
          { $addFields: { isObservedByElection: observedExpr } },
          { $match: { 'table.active': true, isObservedByElection: { $ne: true } } },
          {
            $project: {
              _id: 0,
              electionId: 1,
              tableCode: 1,
              location: 1,
              votes: 1,
              status: 1,
              projectionVersion: { $literal: projectionVersion },
              projectionUpdatedAt: { $literal: projectionUpdatedAt },
            },
          },
          {
            $merge: {
              into: 'live_effective_ballots',
              on: ['electionId', 'tableCode'],
              whenMatched: 'replace',
              whenNotMatched: 'insert',
            },
          },
        ],
        { allowDiskUse: true },
      )
      .toArray();

    const totalTablesAgg = await this.liveEffectiveBallotModel.db
      .collection('electoral_tables')
      .aggregate(
        [
          { $match: { active: true } },
          { $addFields: { observedKey: observedKey } },
          {
            $addFields: {
              isObservedByElection: {
                $ifNull: [
                  {
                    $first: {
                      $map: {
                        input: {
                          $filter: {
                            input: { $objectToArray: '$observedByElection' },
                            as: 'kv',
                            cond: { $eq: ['$$kv.k', '$observedKey'] },
                          },
                        },
                        as: 'kv2',
                        in: '$$kv2.v',
                      },
                    },
                  },
                  false,
                ],
              },
            },
          },
          { $match: { isObservedByElection: { $ne: true } } },
          { $count: 'n' },
        ],
        { allowDiskUse: true },
      )
      .toArray();
    const totalTables = totalTablesAgg[0]?.n ?? 0;

    await this.liveProjectionMetaModel.updateOne(
      { electionId: eid },
      {
        $set: {
          totalTables,
          projectionVersion,
          projectionUpdatedAt,
        },
      },
      { upsert: true },
    );

    await this.liveEffectiveBallotModel.deleteMany({
      electionId: eid,
      projectionVersion: { $ne: projectionVersion },
    });

    this.logger.log(`Live projection rebuilt for election=${electionId}`);
  }
}
