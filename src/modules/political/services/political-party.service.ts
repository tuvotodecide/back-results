/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  PoliticalParty,
  PoliticalPartyDocument,
} from '../schemas/political-party.schema';
import {
  CreatePoliticalPartyDto,
  UpdatePoliticalPartyDto,
  PoliticalPartyQueryDto,
} from '../dto/political-party.dto';

@Injectable()
export class PoliticalPartyService {
  constructor(
    @InjectModel(PoliticalParty.name)
    private politicalPartyModel: Model<PoliticalPartyDocument>,
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

  async validatePartyIds(partyIds: string[]): Promise<boolean> {
    const parties = await this.politicalPartyModel
      .find({ partyId: { $in: partyIds }, active: true })
      .exec();

    return parties.length === partyIds.length;
  }
}
