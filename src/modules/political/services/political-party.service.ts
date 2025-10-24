/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  PoliticalParty,
  PoliticalPartyDocument,
} from '../schemas/political-party.schema';
import {
  CreatePoliticalPartyDto,
  UpdatePoliticalPartyDto,
  PoliticalPartyQueryDto,
} from '../dto/political-party.dto';
import {
  ElectionParty,
  ElectionPartyDocument,
} from '../schemas/election-party-schema';
import { UpdateElectionPartyDto } from '../dto/election-party.dto';

@Injectable()
export class PoliticalPartyService {
  constructor(
    @InjectModel(PoliticalParty.name)
    private politicalPartyModel: Model<PoliticalPartyDocument>,
    @InjectModel(ElectionParty.name)
    private electionPartyModel: Model<ElectionPartyDocument>,
  ) {}

  async create(createDto: CreatePoliticalPartyDto): Promise<PoliticalParty> {
    try {
      const party = new this.politicalPartyModel(createDto);
      return await party.save();
    } catch (error) {
      if (error.code === 11000) {
        throw new ConflictException('El ID del partido ya existe');
      }
      throw error;
    }
  }

  async findAll(query: PoliticalPartyQueryDto): Promise<PoliticalParty[]> {
    const filter: any = {};

    if (query.active !== undefined) {
      filter.active = query.active === 'true';
    }

    if (query.search) {
      filter.$or = [
        { partyId: { $regex: query.search, $options: 'i' } },
        { fullName: { $regex: query.search, $options: 'i' } },
        { shortName: { $regex: query.search, $options: 'i' } },
      ];
    }

    return this.politicalPartyModel.find(filter).sort({ partyId: 1 }).exec();
  }

  async findOne(id: string): Promise<PoliticalParty> {
    const party = await this.politicalPartyModel.findById(id).exec();
    if (!party) {
      throw new NotFoundException('Partido político no encontrado');
    }
    return party;
  }

  async findByPartyId(partyId: string): Promise<PoliticalParty> {
    const party = await this.politicalPartyModel.findOne({ partyId }).exec();
    if (!party) {
      throw new NotFoundException('Partido político no encontrado');
    }
    return party;
  }

  async update(
    id: string,
    updateDto: UpdatePoliticalPartyDto,
  ): Promise<PoliticalParty> {
    try {
      const party = await this.politicalPartyModel
        .findByIdAndUpdate(
          id,
          { $set: updateDto },
          { new: true, runValidators: true },
        )
        .exec();

      if (!party) {
        throw new NotFoundException('Partido político no encontrado');
      }

      return party;
    } catch (error) {
      if (error.code === 11000) {
        throw new ConflictException('El ID del partido ya existe');
      }
      throw error;
    }
  }

  async remove(id: string): Promise<void> {
    const result = await this.politicalPartyModel.deleteOne({ _id: id }).exec();
    if (result.deletedCount === 0) {
      throw new NotFoundException('Partido político no encontrado');
    }
  }

  async getActiveParties(): Promise<PoliticalParty[]> {
    return this.politicalPartyModel
      .find({ active: true })
      .sort({ partyId: 1 })
      .exec();
  }

  async validatePartyIds(
    partyIds: string[],
    electionId?: string,
  ): Promise<boolean> {
    const clean = Array.from(new Set((partyIds ?? []).filter(Boolean)));
    if (clean.length === 0) return true;

    if (electionId) {
      return this.validatePartyIdsForElection(electionId, clean);
    }

    const parties = await this.politicalPartyModel
      .find({ partyId: { $in: clean }, active: true })
      .select({ _id: 0, partyId: 1 })
      .lean()
      .exec();

    return parties.length === clean.length;
  }

  // Habilitar varios partidos (arrays) para una elección
  async assignPartiesToElection(electionId: string, partyIds: string[]) {
    const eid = new Types.ObjectId(electionId);
    const ops = (partyIds ?? []).filter(Boolean).map((pid) => ({
      updateOne: {
        filter: { electionId: eid, partyId: pid },
        update: {
          $setOnInsert: {
            electionId: eid,
            partyId: pid,
            createdAt: new Date(),
          },
          $set: { active: true, updatedAt: new Date() },
        },
        upsert: true,
      },
    }));
    if (!ops.length) return { assigned: 0 };
    const res = await this.electionPartyModel.bulkWrite(ops);
    const modified = res.modifiedCount ?? 0;
    const upserted = res.upsertedCount ?? 0;
    return { assigned: modified + upserted };
  }

  // Deshabilitar varios partidos para una elección
  async removePartiesFromElection(electionId: string, partyIds: string[]) {
    const eid = new Types.ObjectId(electionId);
    const r = await this.electionPartyModel.updateMany(
      { electionId: eid, partyId: { $in: partyIds } },
      { $set: { active: false, updatedAt: new Date() } },
    );
    return { removed: r.modifiedCount ?? 0 };
  }

  // Listar partidos (y metadatos) de una elección
  async getElectionParties(electionId: string) {
    const eid = new Types.ObjectId(electionId);
    return this.electionPartyModel
      .find({ electionId: eid })
      .sort({ active: -1, ballotNumber: 1, partyId: 1 })
      .lean()
      .exec();
  }

  // Editar metadatos por elección (número de papeleta, alianza, color, active)
  async updateElectionParty(id: string, dto: UpdateElectionPartyDto) {
    const updated = await this.electionPartyModel
      .findByIdAndUpdate(id, { $set: dto }, { new: true })
      .exec();
    if (!updated) throw new NotFoundException('ElectionParty no encontrado');
    return updated;
  }

  // Validación CLAVE: que los partyIds estén habilitados para ESA elección
  async validatePartyIdsForElection(
    electionId: string | Types.ObjectId,
    partyIds: string[],
  ): Promise<boolean> {
    const eid =
      typeof electionId === 'string'
        ? new Types.ObjectId(electionId)
        : electionId;
    const clean = Array.from(new Set((partyIds ?? []).filter(Boolean)));
    if (clean.length === 0) return true;
    const count = await this.electionPartyModel.countDocuments({
      electionId: eid,
      partyId: { $in: clean },
      active: true,
    });
    return count === clean.length;
  }
}
