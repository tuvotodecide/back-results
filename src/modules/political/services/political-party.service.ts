/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
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
import { Department } from '../../geographic/schemas/department.schema';
import { Municipality } from '../../geographic/schemas/municipality.schema';
import {
  readColorPalette,
  resolveColorPaletteInput,
} from '@/shared/utils/color-palette.util';

@Injectable()
export class PoliticalPartyService {
  private readonly partyIdCollation = { locale: 'en', strength: 2 };

  private sortAssignments<T extends {
    assignmentOrder?: number | null;
    ballotNumber?: number | null;
    partyId?: string | null;
    createdAt?: Date | string | null;
  }>(assignments: T[]): T[] {
    return [...assignments].sort((a, b) => {
      const aOrder =
        typeof a?.assignmentOrder === 'number'
          ? a.assignmentOrder
          : Number.MAX_SAFE_INTEGER;
      const bOrder =
        typeof b?.assignmentOrder === 'number'
          ? b.assignmentOrder
          : Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) {
        return aOrder - bOrder;
      }

      const aBallot =
        typeof a?.ballotNumber === 'number'
          ? a.ballotNumber
          : Number.MAX_SAFE_INTEGER;
      const bBallot =
        typeof b?.ballotNumber === 'number'
          ? b.ballotNumber
          : Number.MAX_SAFE_INTEGER;
      if (aBallot !== bBallot) {
        return aBallot - bBallot;
      }

      const aCreated = a?.createdAt ? new Date(a.createdAt).getTime() : Number.MAX_SAFE_INTEGER;
      const bCreated = b?.createdAt ? new Date(b.createdAt).getTime() : Number.MAX_SAFE_INTEGER;
      if (aCreated !== bCreated) {
        return aCreated - bCreated;
      }

      return String(a?.partyId || '').localeCompare(
        String(b?.partyId || ''),
        'en',
        { sensitivity: 'base' },
      );
    });
  }

  constructor(
    @InjectModel(PoliticalParty.name)
    private politicalPartyModel: Model<PoliticalPartyDocument>,
    @InjectModel(ElectionParty.name)
    private electionPartyModel: Model<ElectionPartyDocument>,
    @InjectModel(Department.name)
    private departmentModel: Model<Department>,
    @InjectModel(Municipality.name)
    private municipalityModel: Model<Municipality>,
  ) {}

  private mapPoliticalParty(party: any) {
    const palette = readColorPalette(party);
    return {
      ...party,
      _id: party?._id,
      color: palette.color,
      colors: palette.colors,
    };
  }

  private mapElectionParty(assignment: any, party?: any) {
    const palette = readColorPalette({
      colors: assignment?.colors ?? party?.colors,
      color: assignment?.color || party?.color || null,
    });
    return {
      ...assignment,
      _id: assignment?._id,
      shortName: party?.shortName ?? assignment?.shortName ?? null,
      fullName: party?.fullName ?? assignment?.fullName ?? null,
      logoUrl: party?.logoUrl ?? assignment?.logoUrl ?? null,
      color: palette.color,
      colors: palette.colors,
    };
  }

  async create(createDto: CreatePoliticalPartyDto): Promise<PoliticalParty> {
    try {
      const palette = resolveColorPaletteInput(createDto, {
        requireAtLeastOne: true,
        fieldLabel: 'colors',
      });
      const party = new this.politicalPartyModel({
        ...createDto,
        color: palette.color,
        colors: palette.colors,
      });
      const saved = await party.save();
      return this.mapPoliticalParty(saved.toObject ? saved.toObject() : saved) as PoliticalParty;
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

    const parties = await this.politicalPartyModel.find(filter).sort({ partyId: 1 }).lean().exec();
    return parties.map((party) => this.mapPoliticalParty(party)) as PoliticalParty[];
  }

  async findOne(id: string): Promise<PoliticalParty> {
    const party = await this.politicalPartyModel.findById(id).lean().exec();
    if (!party) {
      throw new NotFoundException('Partido político no encontrado');
    }
    return this.mapPoliticalParty(party) as PoliticalParty;
  }

  async findByPartyId(partyId: string): Promise<PoliticalParty> {
    const party = await this.politicalPartyModel.findOne({ partyId }).lean().exec();
    if (!party) {
      throw new NotFoundException('Partido político no encontrado');
    }
    return this.mapPoliticalParty(party) as PoliticalParty;
  }

  async update(
    id: string,
    updateDto: UpdatePoliticalPartyDto,
  ): Promise<PoliticalParty> {
    try {
      const updatePayload: Record<string, unknown> = { ...updateDto };
      if (updateDto.colors !== undefined || updateDto.color !== undefined) {
        const palette = resolveColorPaletteInput(updateDto, {
          requireAtLeastOne: true,
          fieldLabel: 'colors',
        });
        updatePayload.color = palette.color;
        updatePayload.colors = palette.colors;
      }

      const party = await this.politicalPartyModel
        .findByIdAndUpdate(
          id,
          { $set: updatePayload },
          { new: true, runValidators: true },
        )
        .exec();

      if (!party) {
        throw new NotFoundException('Partido político no encontrado');
      }

      return this.mapPoliticalParty(party?.toObject ? party.toObject() : party) as PoliticalParty;
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
    const parties = await this.politicalPartyModel
      .find({ active: true })
      .sort({ partyId: 1 })
      .lean()
      .exec();
    return parties.map((party) => this.mapPoliticalParty(party)) as PoliticalParty[];
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
      .collation(this.partyIdCollation)
      .lean()
      .exec();

    return parties.length === clean.length;
  }

  // Habilitar varios partidos (arrays) para una elección
  // Con filtrado territorial opcional
  async assignPartiesToElection(
    electionId: string,
    partyIds: string[],
    departmentId?: string,
    municipalityId?: string,
  ) {
    const eid = new Types.ObjectId(electionId);

    // Resolver nombres de territorios si se proporcionan
    let departmentOid: Types.ObjectId | null = null;
    let municipalityOid: Types.ObjectId | null = null;
    let departmentName: string | null = null;
    let municipalityName: string | null = null;

    if (departmentId) {
      const dept = await this.departmentModel.findById(departmentId).exec();
      if (!dept) {
        throw new NotFoundException(`Departamento no encontrado: ${departmentId}`);
      }
      departmentOid = new Types.ObjectId(departmentId);
      departmentName = dept.name;
    }

    if (municipalityId) {
      const muni = await this.municipalityModel.findById(municipalityId).exec();
      if (!muni) {
        throw new NotFoundException(`Municipio no encontrado: ${municipalityId}`);
      }
      municipalityOid = new Types.ObjectId(municipalityId);
      municipalityName = muni.name;
    }

    const ops = (partyIds ?? []).filter(Boolean).map((pid, index) => ({
      updateOne: {
        filter: {
          electionId: eid,
          partyId: pid,
          departmentId: departmentOid,
          municipalityId: municipalityOid,
        },
        update: {
          $setOnInsert: {
            electionId: eid,
            partyId: pid,
            departmentId: departmentOid,
            municipalityId: municipalityOid,
            departmentName: departmentName,
            municipalityName: municipalityName,
            createdAt: new Date(),
          },
          $set: {
            active: true,
            assignmentOrder: index,
            updatedAt: new Date(),
          },
        },
        upsert: true,
        collation: this.partyIdCollation,
      },
    }));

    if (!ops.length) return { assigned: 0 };

    try {
      const res = await this.electionPartyModel.bulkWrite(ops);
      const modified = res.modifiedCount ?? 0;
      const upserted = res.upsertedCount ?? 0;
      return { assigned: modified + upserted };
    } catch (error: any) {
      if (error.code === 11000) {
        throw new ConflictException(
          'Conflicto: uno o más partidos ya están asignados a este territorio',
        );
      }
      throw error;
    }
  }

  // Deshabilitar varios partidos para una elección
  // Con filtrado territorial opcional
  async removePartiesFromElection(
    electionId: string,
    partyIds: string[],
    departmentId?: string,
    municipalityId?: string,
  ) {
    const eid = new Types.ObjectId(electionId);
    const filter: any = {
      electionId: eid,
      partyId: { $in: partyIds },
    };

    // Agregar filtros territoriales si se proporcionan
    if (departmentId) {
      filter.departmentId = new Types.ObjectId(departmentId);
    }
    if (municipalityId) {
      filter.municipalityId = new Types.ObjectId(municipalityId);
    }

    const r = await this.electionPartyModel.updateMany(
      filter,
      { $set: { active: false, updatedAt: new Date() } },
      { collation: this.partyIdCollation },
    );
    return { removed: r.modifiedCount ?? 0 };
  }

  // Listar partidos (y metadatos) de una elección
  async getElectionParties(electionId: string) {
    const eid = new Types.ObjectId(electionId);
    const assignments = await this.electionPartyModel
      .find({ electionId: eid })
      .lean()
      .exec();

    const partyIds = Array.from(
      new Set(
        assignments
          .map((assignment: any) => String(assignment?.partyId || '').trim())
          .filter(Boolean),
      ),
    );

    const parties = partyIds.length
      ? await this.politicalPartyModel
          .find({ partyId: { $in: partyIds } })
          .select({
            _id: 0,
            partyId: 1,
            shortName: 1,
            fullName: 1,
            logoUrl: 1,
            color: 1,
            colors: 1,
          })
          .collation(this.partyIdCollation)
          .lean()
          .exec()
      : [];

    const partyMap = new Map(
      parties.map((party: any) => [String(party.partyId || '').trim(), party]),
    );

    return this.sortAssignments(
      assignments
        .sort((a: any, b: any) => Number(Boolean(b.active)) - Number(Boolean(a.active)))
        .map((assignment: any) =>
          this.mapElectionParty(
            assignment,
            partyMap.get(String(assignment?.partyId || '').trim()),
          ),
        ),
    );
  }

  // Editar metadatos por elección (número de papeleta, alianza, color/colors, active)
  async updateElectionParty(id: string, dto: UpdateElectionPartyDto) {
    const updatePayload: Record<string, unknown> = { ...dto };
    if (dto.colors !== undefined || dto.color !== undefined) {
      const palette = resolveColorPaletteInput(dto, {
        requireAtLeastOne: true,
        fieldLabel: 'colors',
      });
      updatePayload.color = palette.color;
      updatePayload.colors = palette.colors;
    }

    const updated = await this.electionPartyModel
      .findByIdAndUpdate(id, { $set: updatePayload }, { new: true })
      .exec();
    if (!updated) throw new NotFoundException('ElectionParty no encontrado');
    const updatedObject = updated?.toObject ? updated.toObject() : updated;
    const party = await this.politicalPartyModel
      .findOne({ partyId: updatedObject.partyId })
      .select({
        _id: 0,
        partyId: 1,
        shortName: 1,
        fullName: 1,
        logoUrl: 1,
        color: 1,
        colors: 1,
      })
      .collation(this.partyIdCollation)
      .lean()
      .exec();
    return this.mapElectionParty(updatedObject, party);
  }

  // Validación CLAVE: que los partyIds estén habilitados para ESA elección y territorio
  async validatePartyIdsForElection(
    electionId: string | Types.ObjectId,
    partyIds: string[],
    departmentId?: string | Types.ObjectId,
    municipalityId?: string | Types.ObjectId,
  ): Promise<boolean> {
    const eid =
      typeof electionId === 'string'
        ? new Types.ObjectId(electionId)
        : electionId;
    const clean = Array.from(new Set((partyIds ?? []).filter(Boolean)));
    if (clean.length === 0) return true;

    // Construir filtro con validación territorial
    const filter: any = {
      electionId: eid,
      partyId: { $in: clean },
      active: true,
    };

    // Lógica territorial:
    // 1. Si el ballot tiene municipalityId, buscar partidos con ese municipalityId O sin territorio (nacionales)
    // 2. Si el ballot tiene departmentId (sin municipalityId), buscar partidos con ese departmentId O sin territorio
    // 3. Si no tiene territorio, solo buscar partidos nacionales (sin territorio)

    if (municipalityId) {
      const munOid =
        typeof municipalityId === 'string'
          ? new Types.ObjectId(municipalityId)
          : municipalityId;

      const conditions: any[] = [
        { municipalityId: munOid },
        { departmentId: null, municipalityId: null }, // Partidos nacionales
      ];
      if (departmentId) {
        const deptOid =
          typeof departmentId === 'string'
            ? new Types.ObjectId(departmentId)
            : departmentId;
        conditions.push({ departmentId: deptOid, municipalityId: null });
      }

      filter.$or = conditions;
    } else if (departmentId) {
      const deptOid =
        typeof departmentId === 'string'
          ? new Types.ObjectId(departmentId)
          : departmentId;
      filter.$or = [
        { departmentId: deptOid, municipalityId: null },
        { departmentId: null, municipalityId: null }, // Partidos nacionales
      ];
    } else {
      // Sin territorio especificado, solo partidos nacionales
      filter.departmentId = null;
      filter.municipalityId = null;
    }

    const count = await this.electionPartyModel
      .countDocuments(filter)
      .collation(this.partyIdCollation);
    return count === clean.length;
  }

  // Obtener partidos habilitados para un territorio específico
  async getPartiesForTerritory(
    electionId: string,
    departmentId?: string,
    municipalityId?: string,
  ): Promise<any[]> {
    const eid = new Types.ObjectId(electionId);
    const filter: any = {
      electionId: eid,
      active: true,
    };

    // Misma lógica que validatePartyIdsForElection
    if (municipalityId) {
      const munOid = new Types.ObjectId(municipalityId);
      filter.$or = [
        { municipalityId: munOid },
        { departmentId: null, municipalityId: null },
      ];
    } else if (departmentId) {
      const deptOid = new Types.ObjectId(departmentId);
      filter.$or = [
        { departmentId: deptOid, municipalityId: null },
        { departmentId: null, municipalityId: null },
      ];
    } else {
      filter.departmentId = null;
      filter.municipalityId = null;
    }

    const assignments = await this.electionPartyModel
      .find(filter)
      .lean()
      .exec();

    const orderedAssignments = this.sortAssignments(assignments as any[]);

    const partyIds = Array.from(
      new Set(
        orderedAssignments
          .map((assignment: any) => String(assignment?.partyId || '').trim())
          .filter(Boolean),
      ),
    );

    if (!partyIds.length) {
      return [];
    }

    const parties = await this.politicalPartyModel
      .find({ partyId: { $in: partyIds }, active: true })
      .select({
        _id: 0,
        partyId: 1,
        shortName: 1,
        fullName: 1,
        logoUrl: 1,
        color: 1,
        colors: 1,
      })
      .collation(this.partyIdCollation)
      .lean()
      .exec();

    const partyMap = new Map(
      parties.map((party: any) => [String(party.partyId || '').trim(), party]),
    );

    return orderedAssignments.map((assignment: any) => {
      const party = partyMap.get(String(assignment?.partyId || '').trim());
      const palette = readColorPalette({
        colors: assignment?.colors ?? party?.colors,
        color: assignment?.color || party?.color || null,
      });
      return {
        ...assignment,
        shortName: party?.shortName || assignment?.partyId || null,
        fullName: party?.fullName || null,
        logoUrl: party?.logoUrl || null,
        color: palette.color,
        colors: palette.colors,
      };
    });
  }
}
