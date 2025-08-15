/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Attestation } from '../schemas/attestation.schema';
import { Ballot } from '../../ballot/schemas/ballot.schema';
import { AttestationCase } from '../schemas/attestation-case.schema';
import { ElectionConfigService } from '@/modules/elections/services/election-config.service';

@Injectable()
export class AttestationResolverService {
  private readonly logger = new Logger(AttestationResolverService.name);

  constructor(
    @InjectModel(Attestation.name) private attModel: Model<Attestation>,
    @InjectModel(Ballot.name) private ballotModel: Model<Ballot>,
    @InjectModel(AttestationCase.name) private caseModel: Model<AttestationCase>,
    private electionConfigService: ElectionConfigService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async resolvePending() {
    const status = await this.electionConfigService.getElectionStatus();
    // No resolvemos hasta que acabe el período de votación (y haya config activa)
    if (!status.hasActiveConfig || status.isVotingPeriod) {
      this.logger.debug('Aún en período de votación o sin config activa. No se resuelve.');
      return;
    }

    // Mesas con atestiguamientos
    const tableCodes: Array<{ tableCode: string }> = await this.attModel.aggregate([
      {
        $lookup: {
          from: 'ballots',
          localField: 'ballotId',
          foreignField: '_id',
          as: 'ballot',
        },
      },
      { $unwind: '$ballot' },
      { $group: { _id: '$ballot.tableCode' } },
      { $project: { _id: 0, tableCode: '$_id' } },
    ]);

    for (const { tableCode } of tableCodes) {
      const existing = await this.caseModel.findOne({ tableCode }).exec();
      if (existing && existing.status) continue; // ya resuelta
      await this.resolveCase(tableCode);
    }
  }

  private async resolveCase(tableCode: string) {
    const ballots = await this.ballotModel.find({ tableCode }).exec();
    if (ballots.length === 0) return;

    const ballotIds = ballots.map((b) => b._id as Types.ObjectId);
    const attestations = await this.attModel
      .find({ ballotId: { $in: ballotIds }, support: true })
      .lean()
      .exec();
    if (attestations.length === 0) return;

    const perBallot: Record<string, { users: number; juries: number }> = {};
    for (const a of attestations) {
      const key = (a.ballotId as Types.ObjectId).toString();
      if (!perBallot[key]) perBallot[key] = { users: 0, juries: 0 };
      if (a.isJury) perBallot[key].juries += 1;
      else perBallot[key].users += 1;
    }

    const supportedBallots = Object.keys(perBallot).filter(
      (id) => perBallot[id].users + perBallot[id].juries > 0,
    );

    let status: 'VERIFYING' | 'CONSENSUAL' | 'CLOSED' = 'VERIFYING';
    let winningBallotId: Types.ObjectId | undefined;
    const summary: any = { perBallot, reason: '' };

    // Caso 1: solo 1 acta con apoyo => reglas de unanimidad
    if (supportedBallots.length <= 1) {
      const only = supportedBallots.length === 1 ? supportedBallots[0] : null;
      if (!only) {
        summary.reason = 'Sin apoyos';
        await this.upsertCase(tableCode, 'VERIFYING', undefined, summary);
        return;
      }
      const v = perBallot[only];
      const hasJury = v.juries >= 1;        // "1 jurado basta"
      const enoughUsers = v.users >= 3;     // ">=3 usuarios"
      const mixed = hasJury && v.users >= 1;// "mixto con >=1 usuario"

      if (hasJury || enoughUsers || mixed) {
        status = 'CLOSED';
        winningBallotId = new Types.ObjectId(only);
        summary.reason = 'Unanimidad cumplida';
      } else {
        status = 'VERIFYING';
        summary.reason = 'Participación insuficiente';
      }

      await this.upsertCase(tableCode, status, winningBallotId, summary);
      return;
    }

    // Caso 2: múltiples actas => mayorías por usuarios y por jurados
    const userWinner = this.maxBy(supportedBallots, (id) => perBallot[id].users);
    const juryWinner = this.maxBy(supportedBallots, (id) => perBallot[id].juries);

    const userTie = this.isTie(supportedBallots, (id) => perBallot[id].users);
    const juryTie = this.isTie(supportedBallots, (id) => perBallot[id].juries);

    const userMajority = !userTie && perBallot[userWinner!].users > 0 ? userWinner : undefined;
    const juryMajority = !juryTie && perBallot[juryWinner!].juries > 0 ? juryWinner : undefined;

    // Conflicto entre mayoría de usuarios y jurados => VERIFYING
    if (userMajority && juryMajority && userMajority !== juryMajority) {
      status = 'VERIFYING';
      summary.reason = 'Conflicto: mayoría de usuarios vs jurados';
      await this.upsertCase(tableCode, status, undefined, summary);
      return;
    }

    // Elegir ganador (si hay jurados, prima su mayoría; si no, mayoría de usuarios)
    const chosen = juryMajority ?? userMajority;
    if (!chosen) {
      status = 'VERIFYING';
      summary.reason = 'Sin mayorías claras';
      await this.upsertCase(tableCode, status, undefined, summary);
      return;
    }

    // Si gana por usuarios (sin jurados en el ganador), exigir mínimos (>=3 usuarios)
    const hasJuryOnWinner = perBallot[chosen].juries > 0;
    const usersOnWinner = perBallot[chosen].users;

    if (!hasJuryOnWinner && usersOnWinner < 3) {
      status = 'VERIFYING';
      summary.reason = 'Ganador por usuarios pero sin 3+ usuarios (mínimo requerido)';
      await this.upsertCase(tableCode, status, undefined, summary);
      return;
    }

    status = 'CONSENSUAL';
    winningBallotId = new Types.ObjectId(chosen);
    summary.reason = 'Mayoría alcanzada';

    await this.upsertCase(tableCode, status, winningBallotId, summary);
  }

  private async upsertCase(
    tableCode: string,
    status: 'VERIFYING' | 'CONSENSUAL' | 'CLOSED',
    winningBallotId?: Types.ObjectId,
    summary?: any,
  ) {
    await this.caseModel.updateOne(
      { tableCode },
      {
        $set: {
          status,
          winningBallotId: winningBallotId ?? null,
          resolvedAt: new Date(),
          summary: summary ?? {},
        },
      },
      { upsert: true },
    );
  }

  private maxBy<T>(arr: T[], fn: (x: T) => number): T | undefined {
    let maxItem: T | undefined;
    let max = -Infinity;
    for (const it of arr) {
      const v = fn(it);
      if (v > max) {
        max = v;
        maxItem = it;
      }
    }
    const ties = arr.filter((x) => fn(x) === max).length;
    if (ties > 1) return undefined;
    return maxItem;
  }

  private isTie<T>(arr: T[], fn: (x: T) => number): boolean {
    const values = arr.map(fn);
    const max = Math.max(...values);
    return values.filter((v) => v === max).length > 1;
  }
}
