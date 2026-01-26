import { Contract } from "@/modules/contracts/schemas/contract.schema";
import { Connection, Types } from "mongoose";
import request from "supertest";
import Papa from 'papaparse';
import { generateUniqueStrings, randomNumericString, randomPhone } from "../generators";
import { Delegate } from "@/modules/contracts/schemas/delegate.schema";

export async function seedMayors(conn: Connection, electionId: Types.ObjectId) {
  const cbba = await conn.collection('municipalities').findOne({ name: 'Cochabamba' });
  const caracollo = await conn.collection('municipalities').findOne({ name: 'Caracollo' });
  const aiquile = await conn.collection('municipalities').findOne({ name: 'Aiquile' });

  const users = mayorsUsers(
    cbba!._id,
    caracollo!._id,
    aiquile!._id,
  );
  await conn.collection('roled_users').insertMany(Array.from(users.values()));

  const contracts = mayorUserContracts(users, electionId);
  await conn.collection<Contract>('contracts').insertMany(contracts);

  return {users, contracts};
}

export async function seedGovernors(conn: Connection, electionId: Types.ObjectId) {
  const cbba = await conn.collection('departments').findOne({ name: 'La Paz' });
  const santaCruz = await conn.collection('departments').findOne({ name: 'Santa Cruz' });

  const users = governorUsers(
    cbba!._id,
    santaCruz!._id,
  );
  await conn.collection('roled_users').insertMany(Array.from(users.values()));

  const contracts = governorUserContracts(users, electionId);
  await conn.collection<Contract>('contracts').insertMany(contracts);

  return {users, contracts};
}

export type DelegateWithId = Delegate & { _id: Types.ObjectId };
export async function seedRandomDelegates(
  conn: Connection,
  httpServer: any,
  contractIds: string[],
  adminToken: string,
  count: number
): Promise<DelegateWithId[]> {
  const delegates: any[] = [];

  const delegateDnis = generateUniqueStrings(count, () => randomNumericString(3, 6));
  for (let i = 0; i < count; i++) {
    delegates[i] = {
      dni: delegateDnis[i],
      name: `Delegate ${i + 1}`,
      phone: randomPhone(),
      email: `delegate${delegateDnis[i]}@example.com`,
    }
  }

  const csvContent = Papa.unparse(delegates);

  for(let contractId of contractIds) {
    const res = await request(httpServer)
      .post('/api/v1/delegates/upload-csv')
      .auth(adminToken, { type: 'bearer' })
      .attach('file', Buffer.from(csvContent), 'delegates.csv')
      .field('contractId', contractId)
      .expect(201);
  }

  return await conn.collection<Delegate>('delegates').find({ dni: { $in: delegateDnis } }).toArray();
}

export type RoledUserWithId = any & { _id: Types.ObjectId };
const mayorsUsers = (
  cbbaId: Types.ObjectId,
  caracolloId: Types.ObjectId,
  aiquileId: Types.ObjectId,
) => {
  return new Map<string, RoledUserWithId>([
    [
      'Cochabamba',
      {
        "_id": new Types.ObjectId(),
        "dni": "C1",
        "active": true,
        "verificationToken": null,
        "verificationTokenExpiresAt": null,
        "passwordResetToken": null,
        "passwordResetTokenExpiresAt": null,
        "email": "ccbba@example.com",
        "name": "Mayor Cochabamba",
        "password": "$2b$10$YR43oUJ.897w6HOUH4nMkeJkWfg0FHxthUT.oygCzejA4BTTJZdlu",
        "role": "MAYOR",
        "votingDepartmentId": null,
        "votingMunicipalityId": cbbaId,
      }
    ],[
      'Caracollo',
      {
        "_id": new Types.ObjectId(),
        "dni": "C2",
        "active": true,
        "verificationToken": null,
        "verificationTokenExpiresAt": null,
        "passwordResetToken": null,
        "passwordResetTokenExpiresAt": null,
        "email": "ccaracollo@example.com",
        "name": "Mayor Caracollo",
        "password": "$2b$10$YR43oUJ.897w6HOUH4nMkeJkWfg0FHxthUT.oygCzejA4BTTJZdlu",
        "role": "MAYOR",
        "votingDepartmentId": null,
        "votingMunicipalityId": caracolloId,
      }
    ],[
      'Aiquile',
      {
        "_id": new Types.ObjectId(),
        "dni": "C3",
        "active": true,
        "verificationToken": null,
        "verificationTokenExpiresAt": null,
        "passwordResetToken": null,
        "passwordResetTokenExpiresAt": null,
        "email": "caiquile@example.com",
        "name": "Mayor Aiquile",
        "password": "$2b$10$YR43oUJ.897w6HOUH4nMkeJkWfg0FHxthUT.oygCzejA4BTTJZdlu",
        "role": "MAYOR",
        "votingDepartmentId": null,
        "votingMunicipalityId": aiquileId,
      }
    ],
  ]);
}

export type ContractWithId = Contract & { _id: Types.ObjectId };
const mayorUserContracts = (users: Map<string, any>, electionId: Types.ObjectId): ContractWithId[] => [
  {
    "_id": new Types.ObjectId(),
    "active": true,
    "clientId": users.get('Cochabamba')._id,
    "clientRole": "MAYOR" as any,
    "departmentId": null,
    "municipalityId": users.get('Cochabamba').votingMunicipalityId,
    "municipalityName": "Cochabamba",
    "startDate": new Date(new Date().setDate(new Date().getDate() - 1)),
    "electionId": electionId,
    "createdAt": new Date(),
    "updatedAt": new Date(),
  },{
    "_id": new Types.ObjectId(),
    "active": true,
    "clientId": users.get('Caracollo')._id,
    "clientRole": "MAYOR" as any,
    "departmentId": null,
    "municipalityId": users.get('Caracollo').votingMunicipalityId,
    "municipalityName": "Caracollo",
    "startDate": new Date(new Date().setDate(new Date().getDate() - 1)),
    "electionId": electionId,
    "createdAt": new Date(),
    "updatedAt": new Date(),
  },{
    "_id": new Types.ObjectId(),
    "active": true,
    "clientId": users.get('Aiquile')._id,
    "clientRole": "MAYOR" as any,
    "departmentId": null,
    "municipalityId": users.get('Aiquile').votingMunicipalityId,
    "municipalityName": "Aiquile",
    "startDate": new Date(new Date().setDate(new Date().getDate() - 1)),
    "electionId": electionId,
    "createdAt": new Date(),
    "updatedAt": new Date(),
  }
];

const governorUsers = (
  lapazId: Types.ObjectId,
  stCzId: Types.ObjectId,
) => {
  return new Map<string, RoledUserWithId>([
    [
      'La Paz',
      {
        "_id": new Types.ObjectId(),
        "dni": "M1",
        "active": true,
        "verificationToken": null,
        "verificationTokenExpiresAt": null,
        "passwordResetToken": null,
        "passwordResetTokenExpiresAt": null,
        "email": "clapaz@example.com",
        "name": "Governor La Paz",
        "password": "$2b$10$YR43oUJ.897w6HOUH4nMkeJkWfg0FHxthUT.oygCzejA4BTTJZdlu",
        "role": "GOVERNOR",
        "votingDepartmentId": lapazId,
        "votingMunicipalityId": null,
      }
    ],[
      'Santa Cruz',
      {
        "_id": new Types.ObjectId(),
        "dni": "M2",
        "active": true,
        "verificationToken": null,
        "verificationTokenExpiresAt": null,
        "passwordResetToken": null,
        "passwordResetTokenExpiresAt": null,
        "email": "cstcz@example.com",
        "name": "Governor Santa Cruz",
        "password": "$2b$10$YR43oUJ.897w6HOUH4nMkeJkWfg0FHxthUT.oygCzejA4BTTJZdlu",
        "role": "GOVERNOR",
        "votingDepartmentId": stCzId,
        "votingMunicipalityId": null,
      }
    ],
  ]);
}

const governorUserContracts = (users: Map<string, RoledUserWithId>, electionId: Types.ObjectId): ContractWithId[] => [
  {
    "_id": new Types.ObjectId(),
    "active": true,
    "clientId": users.get('La Paz')._id,
    "clientRole": "GOVERNOR" as any,
    "departmentId": users.get('La Paz').votingDepartmentId,
    "municipalityId": null,
    "departmentName": "La Paz",
    "startDate": new Date(new Date().setDate(new Date().getDate() - 1)),
    "electionId": electionId,
    "createdAt": new Date(),
    "updatedAt": new Date(),
  },{
    "_id": new Types.ObjectId(),
    "active": true,
    "clientId": users.get('Santa Cruz')._id,
    "clientRole": "GOVERNOR" as any,
    "departmentId": users.get('Santa Cruz').votingDepartmentId,
    "municipalityId": null,
    "departmentName": "Santa Cruz",
    "startDate": new Date(new Date().setDate(new Date().getDate() - 1)),
    "electionId": electionId,
    "createdAt": new Date(),
    "updatedAt": new Date(),
  }
];