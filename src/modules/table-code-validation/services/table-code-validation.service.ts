import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  TableCodeValidation,
  TableCodeValidationDocument,
  TableCodeValidationStatus,
} from '../schemas/table-code-validation.schema';

@Injectable()
export class TableCodeValidationService {
  constructor(
    @InjectModel(TableCodeValidation.name)
    private readonly tableCodeValidationModel: Model<TableCodeValidationDocument>,
  ) {}

  async ensurePending(
    electionId: Types.ObjectId,
    tableCode: string,
  ): Promise<void> {
    const normalizedTableCode = this.normalizeTableCode(tableCode);
    if (!normalizedTableCode) return;

    await this.tableCodeValidationModel.updateOne(
      { electionId, tableCode: normalizedTableCode },
      {
        $setOnInsert: {
          electionId,
          tableCode: normalizedTableCode,
          status: TableCodeValidationStatus.PENDING_OEP,
        },
      },
      { upsert: true },
    );
  }

  private normalizeTableCode(tableCode?: string): string {
    return String(tableCode ?? '').trim();
  }
}
