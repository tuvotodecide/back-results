import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { PadronVersion, PadronVersionDocument } from "../../schemas/padron-version.schema";
import { PadronEntry, PadronEntryDocument } from "../../schemas/padron-entry.schema";
import { ComparisonReport, ComparisonReportDocument } from "../../schemas/comparison-report.schema";
import { User } from "@/modules/users/schemas/user.schema";
import { normalizeCarnet } from "../../utils/carnet-normalizer";
import { VotingEventDocument } from "../../schemas/voting-event.schema";

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
    private readonly userModel: Model<User>,
  ) {}

  async getPadronUsersFromEvent(event: VotingEventDocument): Promise<User[]> {
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
      .find({ padronVersionId: currentVersion._id, enabled: true }, { carnetNorm: 1 })
      .lean();
    if (!entries.length) {
      return [];
    }

    const carnetSet = new Set(entries.map((e) => e.carnetNorm));
    const users = await this.userModel.find({ active: true }, { _id: 1, dni: 1 }).lean();
    const recipients = users.filter((u) => carnetSet.has(normalizeCarnet(u.dni) ?? ''));

    return recipients;
  }
}
