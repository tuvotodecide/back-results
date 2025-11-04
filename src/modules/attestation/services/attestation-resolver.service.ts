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
import { OracleResolverService } from './oracle-resolver.service';
import { ConfigService } from '@nestjs/config';
import { LocksService } from './locks.services';
import { ResolverRunsService } from './resolver-runs.service';

@Injectable()
export class AttestationResolverService {
  private readonly logger = new Logger(AttestationResolverService.name);
  private readonly useBlockchain: boolean;
  private MAX_RESOLVES_PER_SLICE = Number(
    process.env.MAX_RESOLVES_PER_SLICE ?? 20,
  );
  private SLICE_PAUSE_MS = Number(process.env.SLICE_PAUSE_MS ?? 3000);
  private LOCK_TTL_SECONDS = Number(process.env.LOCK_TTL_SECONDS ?? 120);
  private isRunning = false;

  constructor(
    @InjectModel(Attestation.name) private attModel: Model<Attestation>,
    @InjectModel(Ballot.name) private ballotModel: Model<Ballot>,
    @InjectModel(AttestationCase.name)
    private caseModel: Model<AttestationCase>,
    @InjectModel(ElectoralTable.name)
    private electoralTableModel: Model<ElectoralTable>,
    private electionConfigService: ElectionConfigService,
    private oracleResolver: OracleResolverService,
    private configService: ConfigService,
    private locks: LocksService,
    private runs: ResolverRunsService,
  ) {
    this.useBlockchain =
      this.configService.get('USE_BLOCKCHAIN_RESOLVER') === 'true';
    this.logger.log(
      `🔧 Modo de resolución: ${this.useBlockchain ? 'ON-CHAIN ' : 'OFF-CHAIN '}`,
    );
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async resolvePending() {
    if (this.isRunning) {
      this.logger.warn(
        'resolvePending aún está ejecutándose, se omite este tick de cron',
      );
      return;
    }

    this.isRunning = true;
    try {
      const status = await this.electionConfigService.getElectionStatus();
      // No resolvemos hasta que acabe el período de votación (y haya config activa)
      if (!status.hasActiveConfig || status.isVotingPeriod) {
        this.logger.debug(
          'Aún en período de votación o sin config activa. No se resuelve.',
        );
        return;
      }

      if (this.useBlockchain) {
        await this.resolvePendingOnChain();
      } else {
        await this.resolvePendingOffChain();
      }
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * FLUJO ON-CHAIN
   * 1. Envía al contrato
   * 2. Lee resultados del contrato
   * 3. Guarda en BD
   */
  private async resolvePendingOnChain() {
    this.logger.log('Iniciando resolución ON-CHAIN...');
    this.logger.log(
      `LOCK_OWNER en runtime: ${this.configService.get('LOCK_OWNER') || `back-results:${process.pid}`}`,
    );
    const pendingCases = await this.getPendingCases(); // {electionId, tableCode} mezclados
    if (pendingCases.length === 0) {
      this.logger.log('No hay casos pendientes de resolución');
      return;
    }

    // 1) Agrupar por elección
    const groups = new Map<
      string,
      Array<{ tableCode: string; electionId: string }>
    >();
    for (const item of pendingCases) {
      if (!groups.has(item.electionId)) groups.set(item.electionId, []);
      groups.get(item.electionId)!.push(item);
    }

    // 2) Ordenar grupos por resultsStartDate (si no está, ordenar por electionId)
    const actives = await this.electionConfigService
      .getActiveConfigs()
      .catch(() => []);
    const byDate = Array.from(groups.entries())
      .map(([electionId, items]) => {
        const cfg = actives?.find((c: any) => c.id === electionId);
        const key = cfg?.resultsStartDate
          ? new Date(cfg.resultsStartDate).getTime()
          : Number.MAX_SAFE_INTEGER;
        return { electionId, items, key };
      })
      .sort(
        (a, b) => a.key - b.key || a.electionId.localeCompare(b.electionId),
      );

    // 3) Procesar elección por elección
    const owner =
      this.configService.get('LOCK_OWNER') || `back-results:${process.pid}`;
    for (const { electionId, items } of byDate) {
      const ok = await this.locks.tryAcquire(
        `resolve:${electionId}`,
        owner,
        this.LOCK_TTL_SECONDS,
      );
      if (!ok) {
        const k = `resolve:${electionId}`;
        const peek = await this.locks.peek(k);
        this.logger.warn(
          `Diagnóstico lock ${k} -> owner=${peek?.owner} expiresAt=${peek?.expiresAt?.toISOString?.()}`,
        );
        continue;
      }
      try {
        await this.processElectionSlices(electionId, items);
      } catch (e) {
        this.logger.error(`Fallo procesando elección ${electionId}`, e);
        await this.runs.save(electionId, { lastError: String(e) });
      } finally {
        await this.locks
          .release(`resolve:${electionId}`, owner)
          .catch(() => {});
      }
    }

    this.logger.log('Proceso de resolución ON-CHAIN completado');
  }

  /**
   *  FLUJO OFF-CHAIN (Tests)
   * 1. Calcula localmente
   * 2. Guarda en BD
   */
  private async resolvePendingOffChain() {
    this.logger.log('Iniciando resolución OFF-CHAIN (modo tests)...');

    const tableCodes: Array<{ electionId: Types.ObjectId; tableCode: string }> =
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
        {
          $group: {
            _id: { eid: '$ballot.electionId', t: '$ballot.tableCode' },
          },
        },
        { $project: { _id: 0, electionId: '$_id.eid', tableCode: '$_id.t' } },
      ]);

    this.logger.log(`Resolviendo ${tableCodes.length} mesas off-chain...`);

    for (const { electionId, tableCode } of tableCodes) {
      const existing = await this.caseModel
        .findOne({ electionId, tableCode })
        .exec();
      if (existing && existing.status) continue;
      await this.resolveCase(electionId, tableCode);
    }

    this.logger.log('Proceso de resolución OFF-CHAIN completado');
  }

  /**
   * Obtiene casos pendientes de resolución
   */
  private async getPendingCases(): Promise<
    Array<{ tableCode: string; electionId: string }>
  > {
    const results: Array<{ electionId: Types.ObjectId; tableCode: string }> =
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
        {
          $group: {
            _id: { eid: '$ballot.electionId', t: '$ballot.tableCode' },
          },
        },
        { $project: { _id: 0, electionId: '$_id.eid', tableCode: '$_id.t' } },
      ]);

    const pending: Array<{ tableCode: string; electionId: string }> = [];

    for (const item of results) {
      const existing = await this.caseModel
        .findOne({ electionId: item.electionId, tableCode: item.tableCode })
        .exec();

      if (
        !existing ||
        !existing.status ||
        !['CONSENSUAL', 'CLOSED'].includes(existing.status)
      ) {
        pending.push({
          tableCode: item.tableCode,
          electionId: item.electionId.toString(),
        });
      }
    }

    return pending;
  }

  /**
   * Lee el resultado del contrato y lo sincroniza con la BD
   */
  private async syncFromContract(electionId: string, tableCode: string) {
    try {
      const contractResult = await this.oracleResolver.getAttestationInfo(
        tableCode,
        electionId,
      );

      if (!contractResult) {
        this.logger.warn(
          `No se pudo leer resultado de ${tableCode}-${electionId}`,
        );
        return;
      }

      const status = this.oracleResolver.mapContractStatusToString(
        contractResult.status,
      );

      const recordId = contractResult.finalResult.toString();
      let winningBallotId: Types.ObjectId | undefined;

      if (recordId !== '0') {
        const winningBallot = await this.ballotModel
          .findOne({
            electionId: new Types.ObjectId(electionId),
            tableCode,
            recordId,
          })
          .exec();

        if (winningBallot) {
          winningBallotId = winningBallot._id as Types.ObjectId;
          this.logger.log(
            `Ganador encontrado: ballot ${winningBallotId} (recordId: ${recordId})`,
          );
        } else {
          this.logger.warn(
            `No se encontró ballot con recordId ${recordId} para ${tableCode}`,
          );
        }
      }

      await this.upsertCase(
        new Types.ObjectId(electionId),
        tableCode,
        status,
        winningBallotId,
        {
          source: 'on-chain',
          contractStatus: contractResult.status,
          recordId,
          syncedAt: new Date(),
        },
      );

      this.logger.log(
        `Sincronizado ${tableCode}-${electionId}: ${status} ${winningBallotId ? `(ganador: ${winningBallotId})` : '(sin ganador)'}`,
      );
    } catch (error) {
      this.logger.error(
        `Error sincronizando ${tableCode}-${electionId}:`,
        error,
      );
    }
  }

  /**
   * 💻 Resuelve un caso OFF-CHAIN (lógica local)
   */
  private async resolveCase(electionId: Types.ObjectId, tableCode: string) {
    const ballots = await this.ballotModel
      .find({ electionId, tableCode })
      .exec();
    if (ballots.length === 0) return;

    const ballotIds = ballots.map((b) => b._id as Types.ObjectId);

    const attestations = await this.attModel
      .find({ ballotId: { $in: ballotIds }, support: true })
      .lean()
      .exec();

    if (attestations.length === 0) {
      await this.upsertCase(electionId, tableCode, 'VERIFYING', undefined, {
        reason: 'Sin apoyos',
        source: 'off-chain',
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
    const summary = { perBallot, reason: '', source: 'off-chain' };

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
        await this.upsertCase(
          electionId,
          tableCode,
          'VERIFYING',
          undefined,
          summary,
        );
        return;
      }
      const value = perBallot[only];
      if (value.juries >= 1 || value.users >= 3) {
        status = 'CLOSED';
        winningBallotId = new Types.ObjectId(only);
        summary.reason = 'Unanimidad (≥1 jurado o ≥3 usuarios)';
      } else if (
        value.juries === 0 &&
        (value.users === 1 || value.users === 2)
      ) {
        status = 'PENDING';
        winningBallotId = new Types.ObjectId(only);
        summary.reason = '1–2 usuarios sin jurados';
      } else {
        status = 'VERIFYING';
        summary.reason = 'Participación insuficiente';
      }

      await this.upsertCase(
        electionId,
        tableCode,
        status,
        winningBallotId,
        summary,
      );
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
      await this.upsertCase(
        electionId,
        tableCode,
        status,
        winningBallotId,
        summary,
      );
      return;
    }

    // --- Caso: HAY jurados
    if (juryLeaders.length > 1) {
      status = 'VERIFYING';
      summary.reason = 'Empate en jurados';
      await this.upsertCase(electionId, tableCode, status, undefined, summary);
      return;
    }

    const juryWinner = juryLeaders[0];

    if (userLeaders.length > 1) {
      if (
        userLeaders.includes(juryWinner) &&
        perBallot[juryWinner].juries > 0
      ) {
        status = 'CONSENSUAL';
        winningBallotId = new Types.ObjectId(juryWinner);
        summary.reason =
          'Empate de usuarios; decide mayoría de jurados (incluida en el empate)';
      } else {
        status = 'VERIFYING';
        summary.reason = 'Empate de usuarios; jurados favorecen otra acta';
      }
      await this.upsertCase(
        electionId,
        tableCode,
        status,
        winningBallotId,
        summary,
      );
      return;
    }

    const userWinner = userLeaders[0];

    if (userWinner !== juryWinner) {
      status = 'VERIFYING';
      summary.reason = 'Conflicto: mayoría de usuarios vs jurados';
      await this.upsertCase(electionId, tableCode, status, undefined, summary);
      return;
    }

    status = 'CONSENSUAL';
    winningBallotId = new Types.ObjectId(juryWinner);
    summary.reason = 'Mayoría alcanzada';

    await this.upsertCase(
      electionId,
      tableCode,
      status,
      winningBallotId,
      summary,
    );
  }

  /**
   * Guarda/actualiza el caso en BD
   */
  private async upsertCase(
    electionId: Types.ObjectId,
    tableCode: string,
    status: 'VERIFYING' | 'PENDING' | 'CONSENSUAL' | 'CLOSED',
    winningBallotId?: Types.ObjectId,
    summary?: any,
  ) {
    await this.caseModel.updateOne(
      { electionId, tableCode },
      {
        $set: {
          status,
          winningBallotId: winningBallotId ?? null,
          resolvedAt: new Date(),
          summary: summary ?? {},
          electionId,
          tableCode,
        },
      },
      { upsert: true },
    );
    await this.ballotModel.updateMany(
      { electionId, tableCode },
      { $set: { valuable: false } },
    );
    if (winningBallotId) {
      await this.ballotModel.updateOne(
        { _id: winningBallotId },
        { $set: { valuable: true } },
      );
    }

    const observedKey = `observedByElection.${electionId.toString()}`;
    await this.electoralTableModel.updateOne(
      { tableCode },
      { $set: { [observedKey]: status === 'VERIFYING' } },
      { upsert: false },
    );
  }

  private async processElectionSlices(
    electionId: string,
    items: Array<{ tableCode: string; electionId: string }>,
  ) {
    // Recalcula siempre los pendientes de ESTA elección (idempotente)
    const recompute = async () => {
      const all = await this.getPendingCases();
      return all.filter((x) => x.electionId === electionId);
    };

    // Utilidad segura para epoch seconds "ahora".
    const nowSec = () => Math.floor(Date.now() / 1000);

    while (true) {
      const pend = await recompute();
      if (pend.length === 0) break;

      // 1) Tomar un slice pequeño (tu límite por env)
      const batch = pend.slice(0, this.MAX_RESOLVES_PER_SLICE);

      // 2) Cerrar ventana ON-CHAIN para esta elección (si el contrato lo exige)
      try {
        // Si tu OracleResolverService ya no necesita esto, no pasa nada: se ignora.
        await this.oracleResolver.setActiveTimeClose(electionId);
      } catch (e) {
        this.logger.warn(
          `No se pudo cerrar ventana para ${electionId}: ${String(e)}`,
        );
      }

      // 3) Prefiltrar según el ESTADO ON-CHAIN de cada mesa
      const ready: Array<{ tableCode: string; electionId: string }> = [];
      for (const { tableCode } of batch) {
        try {
          const info: any = await this.oracleResolver.getAttestationInfo(
            tableCode,
            electionId,
          );
          if (!info) {
            this.logger.debug(
              `Sin info ON-CHAIN para ${tableCode}-${electionId}, se omite`,
            );
            continue;
          }

          // Heurísticas genéricas (sin cambiar nombres tuyos):
          // - Si el contrato expone "attestEnd": solo resolver cuando attestEnd <= now.
          // - Si ya hay resultado final (finalResult != 0) o estado final, no resolver; solo sincronizar.
          const attestEndSec = await this.oracleResolver.getAttestEnd();
          const hasWinner =
            !!info.finalResult && info.finalResult.toString() !== '0';

          // Si el contrato expone un status numérico, puedes mapearlo a string con tu mapper:
          // const stateStr = this.oracleResolver.mapContractStatusToString(info.status);

          // Demasiado pronto: saltar
          if (attestEndSec && attestEndSec > nowSec()) {
            this.logger.debug(
              `⏳ Too soon ${tableCode}-${electionId} (attestEnd=${attestEndSec}, now=${nowSec()})`,
            );
            continue;
          }

          // Ya cerrado/resuelto en cadena: sincronizar y saltar
          if (hasWinner /* || stateStr === 'CLOSED' etc. */) {
            await this.syncFromContract(electionId, tableCode);
            continue;
          }

          // Listo para resolver
          ready.push({ tableCode, electionId });
        } catch (err) {
          this.logger.warn(
            `No se pudo pre-chequear ${tableCode}-${electionId}: ${String(err)}`,
          );
        }
      }

      if (ready.length === 0) {
        // Reabrir ventana si se cerró arriba (opcional)
        try {
          await this.oracleResolver.setActiveTimeOpen(electionId);
        } catch {}
        // No había nada resolvible; continuar al siguiente ciclo por si cambia el estado.
        await new Promise((r) => setTimeout(r, this.SLICE_PAUSE_MS));
        continue;
      }

      // 4) Enviar on-chain SOLO lo resolvible
      const txResult = await this.oracleResolver.resolveAttestations(ready);
      if (!txResult.success) {
        this.logger.error(
          `Error enviando batch on-chain en ${electionId}:`,
          txResult.error,
        );
        await this.runs.save(electionId, { lastError: String(txResult.error) });
        // Reabrir (opcional) y salir del ciclo para reintentar en el próximo cron
        try {
          await this.oracleResolver.setActiveTimeOpen(electionId);
        } catch {}
        break;
      }

      // 5) Sincronizar resultados del contrato para este batch (idempotente)
      for (const { tableCode } of ready) {
        await this.syncFromContract(electionId, tableCode);
      }
      await this.runs.save(electionId, { lastError: null });

      // 6) Reabrir ventana si la cerraste
      try {
        await this.oracleResolver.setActiveTimeOpen(electionId);
      } catch {}

      // 7) Pausa corta para no saturar bundler/RPC
      await new Promise((r) => setTimeout(r, this.SLICE_PAUSE_MS));
    }
  }
}
