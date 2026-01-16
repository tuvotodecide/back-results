
import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Contract, ContractDocument } from '../schemas/contract.schema';
import { RoledUser, RoledUserDocument } from '../../auth/schemas/roledUser.schema';
import { Department } from '../../geographic/schemas/department.schema';
import { Municipality } from '../../geographic/schemas/municipality.schema';

@Injectable()
export class ContractsService {
  constructor(
    @InjectModel(Contract.name) private contractModel: Model<ContractDocument>,
    @InjectModel(RoledUser.name) private roledUserModel: Model<RoledUserDocument>,
    @InjectModel(Department.name) private departmentModel: Model<Department>,
    @InjectModel(Municipality.name) private municipalityModel: Model<Municipality>,
  ) {}

  /**
   * Crear un contrato para un cliente aprobado
   */
  async create(dto: {
    clientId: string;
    electionId: string;
    departmentId?: string;
    municipalityId?: string;
    startDate: Date;
    endDate?: Date;
  }): Promise<ContractDocument> {
    // Validar que el cliente existe y está activo
    const client = await this.roledUserModel.findById(dto.clientId);
    if (!client) {
      throw new NotFoundException('Cliente no encontrado');
    }
    if (!client.active) {
      throw new BadRequestException('El cliente no está activo/aprobado');
    }

    // Validar que solo haya un territorio
    if (
      (!dto.departmentId && !dto.municipalityId) ||
      (dto.departmentId && dto.municipalityId)
    ) {
      throw new BadRequestException(
        'Debe proporcionar exactamente un territorio (departamento O municipio)',
      );
    }

    // Validar coherencia entre rol y territorio
    if (client.role === 'GOVERNOR' && !dto.departmentId) {
      throw new BadRequestException('Un Gobernador requiere un departamento');
    }
    if (client.role === 'MAYOR' && !dto.municipalityId) {
      throw new BadRequestException('Un Alcalde requiere un municipio');
    }

    let departmentId: Types.ObjectId | null = null;
    let municipalityId: Types.ObjectId | null = null;
    let departmentName: string | undefined;
    let municipalityName: string | undefined;

    if (dto.departmentId) {
      const dept = await this.departmentModel.findById(dto.departmentId);
      if (!dept) throw new NotFoundException('Departamento no encontrado');
      departmentId = new Types.ObjectId(dto.departmentId);
      departmentName = dept.name;
    }

    if (dto.municipalityId) {
      const muni = await this.municipalityModel.findById(dto.municipalityId);
      if (!muni) throw new NotFoundException('Municipio no encontrado');
      municipalityId = new Types.ObjectId(dto.municipalityId);
      municipalityName = muni.name;
    }

    // Verificar que no exista un contrato activo para este cliente/elección
    const existing = await this.contractModel.findOne({
      clientId: new Types.ObjectId(dto.clientId),
      electionId: new Types.ObjectId(dto.electionId),
      active: true,
    });

    if (existing) {
      throw new ConflictException(
        'Ya existe un contrato activo para este cliente en esta elección',
      );
    }

    const contract = await this.contractModel.create({
      active: true,
      clientId: new Types.ObjectId(dto.clientId),
      clientRole: client.role,
      departmentId,
      municipalityId,
      departmentName,
      municipalityName,
      electionId: new Types.ObjectId(dto.electionId),
      startDate: dto.startDate,
      endDate: dto.endDate,
    });

    return contract;
  }

  /**
   * Obtener contratos activos
   */
  async findActiveContracts(filters?: {
    clientId?: string;
    electionId?: string;
    departmentId?: string;
    municipalityId?: string;
  }): Promise<ContractDocument[]> {
    const query: any = { active: true };

    if (filters?.clientId) {
      query.clientId = new Types.ObjectId(filters.clientId);
    }
    if (filters?.electionId) {
      query.electionId = new Types.ObjectId(filters.electionId);
    }
    if (filters?.departmentId) {
      query.departmentId = new Types.ObjectId(filters.departmentId);
    }
    if (filters?.municipalityId) {
      query.municipalityId = new Types.ObjectId(filters.municipalityId);
    }

    return this.contractModel
      .find(query)
      .populate('clientId', 'name email role')
      .populate('departmentId', 'name')
      .populate('municipalityId', 'name')
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Verificar si existe cobertura activa para un territorio
   */
  async hasCoverage(params: {
    electionId: string;
    departmentId?: string;
    municipalityId?: string;
  }): Promise<boolean> {
    const query: any = {
      active: true,
      electionId: new Types.ObjectId(params.electionId),
    };

    if (params.municipalityId) {
      query.municipalityId = new Types.ObjectId(params.municipalityId);
    } else if (params.departmentId) {
      query.departmentId = new Types.ObjectId(params.departmentId);
    }

    const count = await this.contractModel.countDocuments(query);
    return count > 0;
  }

  /**
   * Obtener el contrato activo para un cliente específico
   */
  async getClientContract(
    clientId: string,
    electionId: string,
  ): Promise<ContractDocument | null> {
    return this.contractModel
      .findOne({
        clientId: new Types.ObjectId(clientId),
        electionId: new Types.ObjectId(electionId),
        active: true,
      })
      .populate('departmentId', 'name')
      .populate('municipalityId', 'name')
      .exec();
  }

  /**
   * Desactivar un contrato
   */
  async deactivate(contractId: string): Promise<void> {
    const result = await this.contractModel.updateOne(
      { _id: new Types.ObjectId(contractId) },
      { $set: { active: false, endDate: new Date() } },
    );

    if (result.matchedCount === 0) {
      throw new NotFoundException('Contrato no encontrado');
    }
  }
}