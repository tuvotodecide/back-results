/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ElectionConfig,
  ElectionConfigDocument,
} from '../schemas/election-config.schema';
import {
  CreateElectionConfigDto,
  UpdateElectionConfigDto,
  ElectionConfigResponseDto,
  ElectionStatusResponseDto,
} from '../dto/election-config.dto';
import { TimezoneUtil } from '@/utils/timezone.util';

@Injectable()
export class ElectionConfigService {
  constructor(
    @InjectModel(ElectionConfig.name)
    private electionConfigModel: Model<ElectionConfigDocument>,
  ) {}

  async create(
    createDto: CreateElectionConfigDto,
  ): Promise<ElectionConfigResponseDto> {
    try {
      // Las fechas ya vienen convertidas a UTC por el Transform
      const votingStart = new Date(createDto.votingStartDate);
      const votingEnd = new Date(createDto.votingEndDate);
      const resultsStart = new Date(createDto.resultsStartDate);

      // Validar fechas
      this.validateDates(votingStart, votingEnd, resultsStart);

      // Desactivar configuración anterior
      await this.electionConfigModel.updateMany({}, { isActive: false });

      const config = new this.electionConfigModel({
        name: createDto.name,
        votingStartDate: votingStart,
        votingEndDate: votingEnd,
        resultsStartDate: resultsStart,
        allowDataModification: createDto.allowDataModification || false,
        timezone: 'America/La_Paz',
        isActive: true,
      });

      const savedConfig = await config.save();
      return this.toResponseDto(savedConfig);
    } catch (error) {
      if (error.code === 11000) {
        throw new ConflictException(
          'Ya existe una configuración con ese nombre',
        );
      }
      throw error;
    }
  }

  async getActiveConfig(): Promise<ElectionConfigResponseDto | null> {
    const config = await this.electionConfigModel
      .findOne({ isActive: true })
      .exec();
    return config ? this.toResponseDto(config) : null;
  }

  async findAll(): Promise<ElectionConfigResponseDto[]> {
    const configs = await this.electionConfigModel
      .find()
      .sort({ createdAt: -1 })
      .exec();
    return configs.map((config) => this.toResponseDto(config));
  }

  async findOne(id: string): Promise<ElectionConfigResponseDto> {
    const config = await this.electionConfigModel.findById(id).exec();
    if (!config) {
      throw new NotFoundException('Configuración electoral no encontrada');
    }
    return this.toResponseDto(config);
  }

  async update(
    id: string,
    updateDto: UpdateElectionConfigDto,
  ): Promise<ElectionConfigResponseDto> {
    const config = await this.electionConfigModel.findById(id).exec();
    if (!config) {
      throw new NotFoundException('Configuración electoral no encontrada');
    }

    const updateData: any = {};
    if (updateDto.name) updateData.name = updateDto.name;
    if (updateDto.allowDataModification !== undefined)
      updateData.allowDataModification = updateDto.allowDataModification;
    if (updateDto.isActive !== undefined)
      updateData.isActive = updateDto.isActive;

    // Fechas ya convertidas por Transform
    if (updateDto.votingStartDate)
      updateData.votingStartDate = new Date(updateDto.votingStartDate);
    if (updateDto.votingEndDate)
      updateData.votingEndDate = new Date(updateDto.votingEndDate);
    if (updateDto.resultsStartDate)
      updateData.resultsStartDate = new Date(updateDto.resultsStartDate);

    // Validar fechas si cambiaron
    if (
      updateDto.votingStartDate ||
      updateDto.votingEndDate ||
      updateDto.resultsStartDate
    ) {
      const votingStart = updateData.votingStartDate || config.votingStartDate;
      const votingEnd = updateData.votingEndDate || config.votingEndDate;
      const resultsStart =
        updateData.resultsStartDate || config.resultsStartDate;
      this.validateDates(votingStart, votingEnd, resultsStart);
    }

    // Si se activa, desactivar otras
    if (updateDto.isActive === true) {
      await this.electionConfigModel.updateMany({}, { isActive: false });
    }

    const updatedConfig = await this.electionConfigModel
      .findByIdAndUpdate(id, updateData, { new: true })
      .exec();
    if (!updatedConfig) {
      throw new NotFoundException('Configuración electoral no encontrada');
    }
    return this.toResponseDto(updatedConfig);
  }

  async remove(id: string): Promise<void> {
    const result = await this.electionConfigModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException('Configuración electoral no encontrada');
    }
  }

  async getElectionStatus(): Promise<ElectionStatusResponseDto> {
    const config = await this.getActiveConfig();
    const currentTimeUTC = new Date(); // Hora actual UTC

    if (!config) {
      return {
        isVotingPeriod: false,
        isResultsPeriod: false,
        hasActiveConfig: false,
        currentTime: currentTimeUTC,
        currentTimeBolivia: TimezoneUtil.utcToBolivia(currentTimeUTC),
      };
    }

    // Comparar todo en UTC
    const votingStart = new Date(config.votingStartDate);
    const votingEnd = new Date(config.votingEndDate);
    const resultsStart = new Date(config.resultsStartDate);

    const isVotingPeriod =
      currentTimeUTC >= votingStart && currentTimeUTC <= votingEnd;
    const isResultsPeriod = currentTimeUTC >= resultsStart;

    return {
      isVotingPeriod,
      isResultsPeriod,
      hasActiveConfig: true,
      currentTime: currentTimeUTC,
      currentTimeBolivia: TimezoneUtil.utcToBolivia(currentTimeUTC),
      config,
    };
  }

  async isVotingPeriod(): Promise<boolean> {
    const status = await this.getElectionStatus();
    return (
      status.isVotingPeriod || status.config?.allowDataModification === true
    );
  }

  async isResultsPeriod(): Promise<boolean> {
    const status = await this.getElectionStatus();
    return status.isResultsPeriod;
  }

  private validateDates(
    votingStart: Date,
    votingEnd: Date,
    resultsStart: Date,
  ): void {
    if (votingStart >= votingEnd) {
      throw new BadRequestException(
        'La fecha de inicio debe ser anterior a la fecha de fin',
      );
    }
    if (resultsStart < votingEnd) {
      throw new BadRequestException(
        'La fecha de resultados debe ser posterior al fin de votación',
      );
    }
  }

  private toResponseDto(
    config: ElectionConfigDocument,
  ): ElectionConfigResponseDto {
    return {
      id: (config._id as any).toString(),
      name: config.name,
      votingStartDate: config.votingStartDate,
      votingEndDate: config.votingEndDate,
      resultsStartDate: config.resultsStartDate,
      // Convertir de vuelta a Bolivia para mostrar
      votingStartDateBolivia: TimezoneUtil.utcToBolivia(config.votingStartDate),
      votingEndDateBolivia: TimezoneUtil.utcToBolivia(config.votingEndDate),
      resultsStartDateBolivia: TimezoneUtil.utcToBolivia(
        config.resultsStartDate,
      ),
      isActive: config.isActive,
      allowDataModification: config.allowDataModification,
      timezone: config.timezone,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    };
  }
}
