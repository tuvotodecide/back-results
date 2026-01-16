// src/modules/contracts/services/delegates.service.ts
import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Delegate, DelegateDocument } from '../schemas/delegate.schema';
import { Contract } from '../schemas/contract.schema';
import { UsersService } from '../../users/services/users.service';
import * as Papa from 'papaparse';

@Injectable()
export class DelegatesService {
  constructor(
    @InjectModel(Delegate.name) private delegateModel: Model<DelegateDocument>,
    @InjectModel(Contract.name) private contractModel: Model<Contract>,
    private usersService: UsersService,
  ) {}

  /**
   * Cargar lista de delegados desde CSV
   * Formato esperado: dni,name,phone,email (headers opcionales)
   */
  async uploadDelegatesCsv(params: {
    csvContent: string;
    contractId: string;
    superadminId: string;
  }): Promise<{
    added: number;
    updated: number;
    errors: Array<{ row: number; error: string; data: any }>;
  }> {
    // Verificar que el contrato existe
    const contract = await this.contractModel.findById(params.contractId);
    if (!contract) {
      throw new NotFoundException('Contrato no encontrado');
    }

    // Parsear CSV
    const parsed = Papa.parse(params.csvContent, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      transformHeader: (h) => h.trim().toLowerCase(),
    });

    const errors: Array<{ row: number; error: string; data: any }> = [];
    let added = 0;
    let updated = 0;

    for (let i = 0; i < parsed.data.length; i++) {
      const row = parsed.data[i] as any;
      const rowNum = i + 2; // +2 porque cuenta desde 1 y tiene header

      try {
        const dni = (row.dni || '').toString().trim();
        if (!dni) {
          errors.push({
            row: rowNum,
            error: 'DNI requerido',
            data: row,
          });
          continue;
        }

        // Obtener o crear usuario
        const user = await this.usersService.findOrCreateByDni(dni);

        // Buscar si ya existe este delegado
        const existing = await this.delegateModel.findOne({ dni });

        if (existing) {
          // Verificar si ya está en este contrato
          const alreadyInContract = existing.authorizedContracts.some(
            (ac) => ac.contractId.toString() === params.contractId,
          );

          if (!alreadyInContract) {
            // Agregar nuevo contrato a delegado existente
            await this.delegateModel.updateOne(
              { dni },
              {
                $push: {
                  authorizedContracts: {
                    contractId: new Types.ObjectId(params.contractId),
                    clientId: contract.clientId,
                    clientRole: contract.clientRole,
                    addedAt: new Date(),
                    addedBy: new Types.ObjectId(params.superadminId),
                  },
                },
                $set: {
                  name: row.name?.trim() || existing.name,
                  phone: row.phone?.trim() || existing.phone,
                  email: row.email?.trim() || existing.email,
                },
              },
            );
            updated++;
          } else {
            // Ya existe en este contrato, solo actualizar metadata
            await this.delegateModel.updateOne(
              { dni },
              {
                $set: {
                  name: row.name?.trim() || existing.name,
                  phone: row.phone?.trim() || existing.phone,
                  email: row.email?.trim() || existing.email,
                },
              },
            );
            updated++;
          }
        } else {
          // Crear nuevo delegado
          await this.delegateModel.create({
            dni,
            userId: user._id,
            active: true,
            name: row.name?.trim(),
            phone: row.phone?.trim(),
            email: row.email?.trim(),
            authorizedContracts: [
              {
                contractId: new Types.ObjectId(params.contractId),
                clientId: contract.clientId,
                clientRole: contract.clientRole,
                addedAt: new Date(),
                addedBy: new Types.ObjectId(params.superadminId),
              },
            ],
          });
          added++;
        }
      } catch (error: any) {
        errors.push({
          row: rowNum,
          error: error.message || String(error),
          data: row,
        });
      }
    }

    return { added, updated, errors };
  }

  /**
   * Agregar un delegado manualmente
   */
  async addDelegate(params: {
    dni: string;
    contractId: string;
    superadminId: string;
    name?: string;
    phone?: string;
    email?: string;
  }): Promise<DelegateDocument> {
    const contract = await this.contractModel.findById(params.contractId);
    if (!contract) {
      throw new NotFoundException('Contrato no encontrado');
    }

    const user = await this.usersService.findOrCreateByDni(params.dni);

    const existing = await this.delegateModel.findOne({ dni: params.dni });

    if (existing) {
      // Verificar si ya está en este contrato
      const alreadyIn = existing.authorizedContracts.some(
        (ac) => ac.contractId.toString() === params.contractId,
      );

      if (alreadyIn) {
        throw new BadRequestException(
          'Este delegado ya está autorizado para este contrato',
        );
      }

      // Agregar contrato
      existing.authorizedContracts.push({
        contractId: new Types.ObjectId(params.contractId),
        clientId: contract.clientId,
        clientRole: contract.clientRole,
        addedAt: new Date(),
        addedBy: new Types.ObjectId(params.superadminId),
      });

      if (params.name) existing.name = params.name;
      if (params.phone) existing.phone = params.phone;
      if (params.email) existing.email = params.email;

      return existing.save();
    }

    // Crear nuevo
    return this.delegateModel.create({
      dni: params.dni,
      userId: user._id,
      active: true,
      name: params.name,
      phone: params.phone,
      email: params.email,
      authorizedContracts: [
        {
          contractId: new Types.ObjectId(params.contractId),
          clientId: contract.clientId,
          clientRole: contract.clientRole,
          addedAt: new Date(),
          addedBy: new Types.ObjectId(params.superadminId),
        },
      ],
    });
  }

  /**
   * Remover un delegado de un contrato específico
   */
  async removeFromContract(
    dni: string,
    contractId: string,
  ): Promise<void> {
    const result = await this.delegateModel.updateOne(
      { dni },
      {
        $pull: {
          authorizedContracts: {
            contractId: new Types.ObjectId(contractId),
          },
        },
      },
    );

    if (result.matchedCount === 0) {
      throw new NotFoundException('Delegado no encontrado');
    }
  }

  /**
   * Listar delegados de un contrato
   */
  async listByContract(contractId: string): Promise<DelegateDocument[]> {
    return this.delegateModel
      .find({
        'authorizedContracts.contractId': new Types.ObjectId(contractId),
        active: true,
      })
      .populate('userId', 'dni votingLocationId votingTableId')
      .sort({ name: 1, dni: 1 })
      .exec();
  }

  /**
   * Verificar si un DNI está autorizado para un contrato
   */
  async isAuthorizedForContract(
    dni: string,
    contractId: string,
  ): Promise<boolean> {
    const count = await this.delegateModel.countDocuments({
      dni,
      'authorizedContracts.contractId': new Types.ObjectId(contractId),
      active: true,
    });
    return count > 0;
  }

  /**
   * Obtener contratos autorizados para un DNI
   */
  async getAuthorizedContracts(dni: string): Promise<
    Array<{
      contractId: string;
      clientId: string;
      clientRole: 'MAYOR' | 'GOVERNOR';
    }>
  > {
    const delegate = await this.delegateModel.findOne({ dni, active: true });
    if (!delegate) return [];

    return delegate.authorizedContracts.map((ac) => ({
      contractId: ac.contractId.toString(),
      clientId: ac.clientId.toString(),
      clientRole: ac.clientRole,
    }));
  }
}