/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Attestation } from '../schemas/attestation.schema';
import { Ballot } from '../../ballot/schemas/ballot.schema';
import { AttestationCase } from '../schemas/attestation-case.schema';
import { ElectionConfigService } from '@/modules/elections/services/election-config.service';
import { ElectoralTable } from '@/modules/geographic/schemas/electoral-table.schema';

@Injectable()
export class AttestationResolverService {
  private readonly logger = new Logger(AttestationResolverService.name);

  constructor(
    @InjectModel(Attestation.name) private attModel: Model<Attestation>,
    @InjectModel(Ballot.name) private ballotModel: Model<Ballot>,
    @InjectModel(AttestationCase.name)
    private caseModel: Model<AttestationCase>,
    @InjectModel(ElectoralTable.name)
    private electoralTableModel: Model<ElectoralTable>,
    private electionConfigService: ElectionConfigService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async resolvePending() {
    const status = await this.electionConfigService.getElectionStatus();
    // No resolvemos hasta que acabe el período de votación (y haya config activa)
    if (!status.hasActiveConfig || status.isVotingPeriod) {
      this.logger.debug(
        'Aún en período de votación o sin config activa. No se resuelve.',
      );
      return;
    }

    // Mesas con atestiguamientos
    const tableCodes: Array<{ tableCode: string }> =
      await this.attModel.aggregate([
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
      if (existing && existing.status) continue;
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

    if (attestations.length === 0) {
      await this.upsertCase(tableCode, 'VERIFYING', undefined, {
        reason: 'Sin apoyos',
      });
      return;
    }

    const perBallot: Record<string, { users: number; juries: number }> = {};
    for (const attestation of attestations) {
      const key = (attestation.ballotId as Types.ObjectId).toString();
      if (!perBallot[key]) perBallot[key] = { users: 0, juries: 0 };
      if (attestation.isJury) perBallot[key].juries += 1;
      else perBallot[key].users += 1;
    }

    const supportedBallots = Object.keys(perBallot).filter(
      (id) => perBallot[id].users + perBallot[id].juries > 0,
    );

    let status: 'VERIFYING' | 'PENDING' | 'CONSENSUAL' | 'CLOSED' = 'VERIFYING';
    let winningBallotId: Types.ObjectId | undefined;
    const summary = { perBallot, reason: '' };

    const maxUsers = supportedBallots.length
      ? Math.max(...supportedBallots.map((id) => perBallot[id].users))
      : 0;

    const userLeaders = supportedBallots.filter(
      (id) => perBallot[id].users === maxUsers,
    );

    const maxJuries = supportedBallots.length
      ? Math.max(...supportedBallots.map((id) => perBallot[id].juries))
      : 0;

    const juryLeaders = supportedBallots.filter(
      (id) => perBallot[id].juries === maxJuries,
    );

    const totalJuries = supportedBallots.reduce(
      (s, id) => s + perBallot[id].juries,
      0,
    );

    // --- Caso: solo 0 o 1 acta con apoyo
    if (supportedBallots.length <= 1) {
      const only = supportedBallots[0];
      if (!only) {
        summary.reason = 'Sin apoyos';
        await this.upsertCase(tableCode, 'VERIFYING', undefined, summary);
        return;
      }
      const value = perBallot[only];
      if (value.juries >= 1 || value.users >= 3) {
        // Unanimidad suficiente: cierra
        status = 'CLOSED';
        winningBallotId = new Types.ObjectId(only);
        summary.reason = 'Unanimidad (≥1 jurado o ≥3 usuarios)';
      } else if (
        value.juries === 0 &&
        (value.users === 1 || value.users === 2)
      ) {
        // 1–2 usuarios sin jurados -> PENDING
        status = 'PENDING';
        winningBallotId = new Types.ObjectId(only);
        summary.reason = '1–2 usuarios sin jurados';
      } else {
        status = 'VERIFYING';
        summary.reason = 'Participación insuficiente';
      }

      await this.upsertCase(tableCode, status, winningBallotId, summary);
      return;
    }

    // --- Caso: NO hay jurados en ninguna acta
    if (totalJuries === 0) {
      if (userLeaders.length === 1 && maxUsers >= 3) {
        status = 'CONSENSUAL';
        winningBallotId = new Types.ObjectId(userLeaders[0]);
        summary.reason = '≥3 usuarios, sin jurados';
      } else if (
        userLeaders.length === 1 &&
        (maxUsers === 1 || maxUsers === 2)
      ) {
        status = 'PENDING';
        winningBallotId = new Types.ObjectId(userLeaders[0]);
        summary.reason = '1–2 usuarios, sin jurados';
      } else {
        status = 'VERIFYING';
        summary.reason = 'Empate o apoyos insuficientes (sin jurados)';
      }
      await this.upsertCase(tableCode, status, winningBallotId, summary);
      return;
    }

    // --- Caso: HAY jurados
    // Regla: empate en jurados => VERIFYING (sin importar usuarios)
    if (juryLeaders.length > 1) {
      status = 'VERIFYING';
      summary.reason = 'Empate en jurados';
      await this.upsertCase(tableCode, status, undefined, summary);
      return;
    }

    const juryWinner = juryLeaders[0];

    // Regla: empate en usuarios
    if (userLeaders.length > 1) {
      if (
        userLeaders.includes(juryWinner) &&
        perBallot[juryWinner].juries > 0
      ) {
        // Si la mayoría de jurados está entre las empatadas de usuarios => CONSENSUAL
        status = 'CONSENSUAL';
        winningBallotId = new Types.ObjectId(juryWinner);
        summary.reason =
          'Empate de usuarios; decide mayoría de jurados (incluida en el empate)';
      } else {
        // Si la mayoría de jurados NO está entre las empatadas => VERIFYING
        status = 'VERIFYING';
        summary.reason = 'Empate de usuarios; jurados favorecen otra acta';
      }
      await this.upsertCase(tableCode, status, winningBallotId, summary);
      return;
    }

    const userWinner = userLeaders[0]; // único porque no hubo empate

    if (userWinner !== juryWinner) {
      status = 'VERIFYING';
      summary.reason = 'Conflicto: mayoría de usuarios vs jurados';
      await this.upsertCase(tableCode, status, undefined, summary);
      return;
    }

    status = 'CONSENSUAL';
    winningBallotId = new Types.ObjectId(juryWinner);
    summary.reason = 'Mayoría alcanzada';

    await this.upsertCase(tableCode, status, winningBallotId, summary);
  }

  private async upsertCase(
    tableCode: string,
    status: 'VERIFYING' | 'PENDING' | 'CONSENSUAL' | 'CLOSED',
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
    // Asegurar que SOLO el ganador quede como valuable=true (para que cuente)
    await this.ballotModel.updateMany(
      { tableCode },
      { $set: { valuable: false } },
    );
    if (winningBallotId) {
      await this.ballotModel.updateOne(
        { _id: winningBallotId },
        { $set: { valuable: true } },
      );
    }

    await this.electoralTableModel.updateOne(
      { tableCode },
      { $set: { observed: status === 'VERIFYING' } },
      { upsert: false },
    );
  }

}
