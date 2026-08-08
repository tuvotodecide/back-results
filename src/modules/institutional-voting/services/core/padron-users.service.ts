import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { PadronVersion, PadronVersionDocument } from "../../schemas/padron-version.schema";
import { PadronEntry, PadronEntryDocument } from "../../schemas/padron-entry.schema";
import { ComparisonReport, ComparisonReportDocument } from "../../schemas/comparison-report.schema";
import { User, UserDocument } from "@/modules/users/schemas/user.schema";
import { normalizeCarnet } from "../../utils/carnet-normalizer";
import { VotingEventDocument } from "../../schemas/voting-event.schema";

export type PadronResolvedUser = {
  _id: Types.ObjectId;
  dni: string;
  active: boolean;
  enabled: boolean;
};

export type PadronUser = {
  _id?: Types.ObjectId;
  dni: string;
  active?: boolean;
  enabled: boolean;
};

@Injectable()
export class PadronUsersService {
  constructor(
    @InjectModel(PadronVersion.name)
    private readonly padronVersionModel: Model<PadronVersionDocument>,
    @InjectModel(PadronEntry.name)
    private readonly padronEntryModel: Model<PadronEntryDocument>,
    @InjectModel(ComparisonReport.name)
    private readonly comparisonReportModel: Model<ComparisonReportDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  private async getPadronUsersFromEvent(
    event: VotingEventDocument,
    options: { includeDisabled?: boolean } = {},
  ): Promise<{
    carnetList: string[],
    entryMap: Map<string, boolean>,
  }> {
    const includeDisabled = options.includeDisabled === true;
    const currentVersion = await this.padronVersionModel
      .findOne({ eventId: event._id, isCurrent: true })
      .lean();
    if (!currentVersion) {
      return { carnetList: [], entryMap: new Map<string, boolean>() };
    }

    const reportOk = await this.comparisonReportModel.exists({
      padronVersionId: currentVersion._id,
      status: 'OK',
    });
    if (!reportOk) {
      return { carnetList: [], entryMap: new Map<string, boolean>() };
    }

    const entries = await this.padronEntryModel
      .find(
        {
          padronVersionId: currentVersion._id,
          ...(includeDisabled ? {} : { enabled: true }),
        },
        { carnetNorm: 1, enabled: 1 },
      )
      .lean();
    if (!entries.length) {
      return { carnetList: [], entryMap: new Map<string, boolean>() };
    }

    const entryMap = new Map<string, boolean>();
    entries.forEach((entry) => {
      const normalized = normalizeCarnet(entry.carnetNorm);
      if (!normalized) {
        return;
      }
      if (!entryMap.has(normalized)) {
        entryMap.set(normalized, Boolean(entry.enabled));
      } else if (entry.enabled === true) {
        entryMap.set(normalized, true);
      }
    });

    return {
      carnetList: Array.from(entryMap.keys()),
      entryMap,
    };
  }

  async getResolvedPadronUsersFomEvent(
    event: VotingEventDocument,
    options: { includeDisabled?: boolean } = {},
  ) {
    const {carnetList, entryMap} = await this.getPadronUsersFromEvent(event, options);
    const recipients = await this.userModel
      .find({ dni: { $in: carnetList }, active: true }, { _id: 1, dni: 1, active: 1 })
      .lean();

    return recipients.map((recipient) => ({
      ...recipient,
      enabled: Boolean(entryMap.get(recipient.dni)),
    }));
  }

  async getUnresolverPadronUsersFomEvent(
    event: VotingEventDocument,
    options: { includeDisabled?: boolean } = {},
  ) {
    const {carnetList, entryMap} = await this.getPadronUsersFromEvent(event, options);
    const recipients = await this.userModel
      .find({ dni: { $in: carnetList }, active: true }, { _id: 1, dni: 1, active: 1 })
      .lean();

    return carnetList.map((dni) => {
      const recipient = recipients.find(r => r.dni === dni);

      const data: PadronUser = {
        dni,
        enabled: Boolean(entryMap.get(dni)),
      }
      if (recipient) {
        data._id = recipient._id;
        data.active = recipient.active;
      }

      return data;
    })
  }

  async getUsersByCarnets(
    carnets: string[],
    options: { createMissing?: boolean } = {},
  ): Promise<PadronResolvedUser[]> {
    const normalized = Array.from(
      new Set(
        carnets
          .map((carnet) => normalizeCarnet(carnet))
          .filter((carnet): carnet is string => Boolean(carnet)),
      ),
    );

    if (!normalized.length) {
      return [];
    }

    if (options.createMissing !== false) {
      await this.userModel.bulkWrite(
        normalized.map((dni) => ({
          updateOne: {
            filter: { dni },
            update: {
              $setOnInsert: {
                dni,
                active: true,
              },
            },
            upsert: true,
          },
        })),
        { ordered: false },
      );
    }

    const users = await this.userModel
      .find({ dni: { $in: normalized }, active: true }, { _id: 1, dni: 1, active: 1 })
      .lean();

    return users.map((user) => ({
      ...user,
      enabled: true,
    }));
  }
}
