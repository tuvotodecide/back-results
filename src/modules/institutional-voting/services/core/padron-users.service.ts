import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { PadronVersion, PadronVersionDocument } from "../../schemas/padron-version.schema";
import { PadronEntry, PadronEntryDocument } from "../../schemas/padron-entry.schema";
import { ComparisonReport, ComparisonReportDocument } from "../../schemas/comparison-report.schema";
import { User, UserDocument } from "@/modules/users/schemas/user.schema";
import { normalizeCarnet } from "../../utils/carnet-normalizer";
import { VotingEventDocument } from "../../schemas/voting-event.schema";

type PadronResolvedUser = {
  _id: Types.ObjectId;
  dni: string;
  active: boolean;
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

  async getPadronUsersFromEvent(
    event: VotingEventDocument,
    options: { includeDisabled?: boolean } = {},
  ): Promise<PadronResolvedUser[]> {
    const includeDisabled = options.includeDisabled === true;
    const currentVersion = await this.padronVersionModel
      .findOne({ eventId: event._id, isCurrent: true })
      .lean();
    if (!currentVersion) {
      return [];
    }

    const reportOk = await this.comparisonReportModel.exists({
      padronVersionId: currentVersion._id,
      status: 'OK',
    });
    if (!reportOk) {
      return [];
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
      return [];
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

    const carnetList = Array.from(entryMap.keys());
    if (!carnetList.length) {
      return [];
    }

    await this.userModel.bulkWrite(
      carnetList.map((dni) => ({
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

    const recipients = await this.userModel
      .find({ dni: { $in: carnetList }, active: true }, { _id: 1, dni: 1, active: 1 })
      .lean();


    return recipients.map((recipient) => ({
      ...recipient,
      enabled: Boolean(entryMap.get(recipient.dni)),
    }));
  }
}
