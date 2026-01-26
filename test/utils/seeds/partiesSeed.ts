import { Department } from "@/modules/geographic/schemas/department.schema";
import { Municipality } from "@/modules/geographic/schemas/municipality.schema";
import { ElectionParty } from "@/modules/political/schemas/election-party-schema";
import { PoliticalParty } from "@/modules/political/schemas/political-party.schema";
import { Connection, Types } from "mongoose";

export type PartiesSeedInput = {
  codes: string[];
  assignedLoc: string;
  locType: 'department' | 'municipality';
}
export async function seedParties(conn: Connection, parties: PartiesSeedInput, electionId: Types.ObjectId) {
  let departmentId: Types.ObjectId | null = null;
  let municipalityId: Types.ObjectId | null = null;

  if (parties.locType === 'department') {
    departmentId = await conn.collection<Department>('departments').findOne({ name: parties.assignedLoc }).then(dept => dept?._id || null);
    if (!departmentId) {
      throw new Error(`Department with name ${parties.assignedLoc} not found`);
    }
  } else {
    municipalityId = await conn.collection<Municipality>('municipalities').findOne({ name: parties.assignedLoc }).then(mun => mun?._id || null);
    if (!municipalityId) {
      throw new Error(`Municipality with name ${parties.assignedLoc} not found`);
    }
  }

  const partyIds = await conn.collection<PoliticalParty>('political_parties').insertMany(
    parties.codes.map(code => ({
      partyId: code,
      fullName: `Full Name ${code}`,
      shortName: `Short ${code}`,
      color: '#2196F3',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  );

  console.log('Inserted Political Parties:', partyIds.insertedIds);
  const assignedPartyIds = parties.codes.map((_, index) => ({
    electionId,
    partyId: partyIds.insertedIds[index]._id.toString(),
    active: true,
    departmentId,
    municipalityId,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  console.log('Assigned Election Parties:', assignedPartyIds);

  await conn.collection<ElectionParty>('election_parties').insertMany(
    assignedPartyIds
  );

  return partyIds.insertedIds;
}