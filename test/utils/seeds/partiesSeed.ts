import { PoliticalParty } from "@/modules/political/schemas/political-party.schema";
import { Connection, Types } from "mongoose";


export async function seedParties(conn: Connection, partyCodes: string[], electionId: Types.ObjectId) {
  const partyIds = await conn.collection<PoliticalParty>('political_parties').insertMany(
    partyCodes.map(code => ({
      partyId: code,
      fullName: `Full Name ${code}`,
      shortName: `Short ${code}`,
      color: '#2196F3',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  );
  return partyIds.insertedIds;
}