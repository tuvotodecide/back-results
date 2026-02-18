import { Connection, Types } from "mongoose";

export async function seedElectionConfigWith(conn: Connection, electionKey: string) {
  const election = electionConfigsSeed.get(electionKey);
  if (!election) {
    throw new Error(`No election config seed found for key: ${electionKey}`);
  }

  return await conn.collection('election_configs').insertOne(election);
}

export const electionConfigsSeed = new Map<string, any>([
  [
    'activeElection',
    {
      "_id": new Types.ObjectId(),
      "name": "Elecciones Generales 2025",
      "votingStartDate": new Date(new Date().setDate(new Date().getDate() - 1)),
      "votingEndDate": new Date(new Date().setDate(new Date().getDate() + 1)),
      "resultsStartDate": new Date(new Date().setDate(new Date().getDate() + 2)),
      "isActive": true,
      "allowDataModification": true,
      "timezone": "America/La_Paz",
      "type": "presidential",
      "round": 1,
    }
  ],
  [
    'pastElection',
    {
      "_id": new Types.ObjectId(),
      "name": "Elecciones Generales 2024",
      "votingStartDate": new Date(new Date().setDate(new Date().getDate() - 10)),
      "votingEndDate": new Date(new Date().setDate(new Date().getDate() - 9)),
      "resultsStartDate": new Date(new Date().setDate(new Date().getDate() - 8)),
      "isActive": true,
      "allowDataModification": true,
      "timezone": "America/La_Paz",
      "type": "presidential",
      "round": 1,
    }
  ],
  [
    'inactiveElection',
    {
      "_id": new Types.ObjectId(),
      "name": "Elecciones Generales 2023",
      "votingStartDate": new Date(new Date().setDate(new Date().getDate() - 10)),
      "votingEndDate": new Date(new Date().setDate(new Date().getDate() - 9)),
      "resultsStartDate": new Date(new Date().setDate(new Date().getDate() - 8)),
      "isActive": false,
      "allowDataModification": true,
      "timezone": "America/La_Paz",
      "type": "presidential",
      "round": 1,
    }
  ]
]);