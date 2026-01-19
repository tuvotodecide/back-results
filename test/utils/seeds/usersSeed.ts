import { Connection, Types } from "mongoose";
import { electionConfigsSeed } from "./electionsSeed";

export async function seedUsers(conn: Connection) {
  const lapaz = await conn.collection('departments').findOne({ name: 'La Paz' });
  const cbba = await conn.collection('municipalities').findOne({ name: 'Cochabamba' });

  const users = await usersSeed(lapaz?._id, cbba?._id);
  await conn.collection('roled_users').insertMany(Array.from(users.values()));

  return users;
}

export async function seedContracts(conn: Connection, users: Map<string, any>, electionKey: string) {
  const contracts = contractsSeed(users, electionKey);
  await conn.collection('contracts').insertMany(contracts);
}

// all user's password are 'secret123'
export const usersSeed = async (laPazId?: Types.ObjectId, cbbaId?: Types.ObjectId) => {
  return new Map<string, any>([
    [
      'notVerifiedEmail',
      {
        "_id": new Types.ObjectId("507f1f77bcf86cd799439011"),
        "dni": "1",
        "active": false,
        "verificationToken": "some-token",
        "verificationTokenExpiresAt": null,
        "passwordResetToken": null,
        "passwordResetTokenExpiresAt": null,
        "email": "nev@example.com",
        "name": "Not Email Verified",
        "password": "$2b$10$YR43oUJ.897w6HOUH4nMkeJkWfg0FHxthUT.oygCzejA4BTTJZdlu",
        "role": "GOVERNOR",
        "votingDepartmentId": laPazId,
        "votingMunicipalityId": null,
      },
    ],[
      'notActive',
      {
        "_id": new Types.ObjectId("507f1f77bcf86cd799439012"),
        "dni": "2",
        "active": false,
        "verificationToken": null,
        "verificationTokenExpiresAt": null,
        "passwordResetToken": null,
        "passwordResetTokenExpiresAt": null,
        "email": "nau@example.com",
        "name": "Not Active User",
        "password": "$2b$10$YR43oUJ.897w6HOUH4nMkeJkWfg0FHxthUT.oygCzejA4BTTJZdlu",
        "role": "GOVERNOR",
        "votingDepartmentId": laPazId,
        "votingMunicipalityId": null,
      }
    ],[
      'governorLaPaz',
      {
        "_id": new Types.ObjectId("507f1f77bcf86cd799439013"),
        "dni": "3",
        "active": true,
        "verificationToken": null,
        "verificationTokenExpiresAt": null,
        "passwordResetToken": null,
        "passwordResetTokenExpiresAt": null,
        "email": "glp@example.com",
        "name": "Governor La Paz",
        "password": "$2b$10$YR43oUJ.897w6HOUH4nMkeJkWfg0FHxthUT.oygCzejA4BTTJZdlu",
        "role": "GOVERNOR",
        "votingDepartmentId": laPazId,
        "votingMunicipalityId": null,
      }
    ],[
      'mayorCbba',
      {
        "_id": new Types.ObjectId("507f1f77bcf86cd799439014"),
        "dni": "4",
        "active": true,
        "verificationToken": null,
        "verificationTokenExpiresAt": null,
        "passwordResetToken": null,
        "passwordResetTokenExpiresAt": null,
        "email": "mcbba@example.com",
        "name": "Mayor Cochabamba",
        "password": "$2b$10$YR43oUJ.897w6HOUH4nMkeJkWfg0FHxthUT.oygCzejA4BTTJZdlu",
        "role": "MAYOR",
        "votingDepartmentId": null,
        "votingMunicipalityId": cbbaId,
      }
    ]
  ]);
};

export const contractsSeed = (users: Map<string, any>, electionKey: string) => [
  {
    "active": true,
    "clientId": users.get('governorLaPaz')._id,
    "clientRole": "GOVERNOR",
    "departmentId": users.get('governorLaPaz').votingDepartmentId,
    "municipalityId": null,
    "departmentName": "La Paz",
    "municipalityName": null,
    "startDate": new Date(new Date().setDate(new Date().getDate() - 1)),
    "endDate": null,
    "electionId": electionConfigsSeed.get(electionKey)._id,
  },{
    "active": true,
    "clientId": users.get('mayorCbba')._id,
    "clientRole": "MAYOR",
    "departmentId": null,
    "municipalityId": users.get('mayorCbba').votingMunicipalityId,
    "departmentName": null,
    "municipalityName": "Cochabamba",
    "startDate": new Date(new Date().setDate(new Date().getDate() - 1)),
    "endDate": null,
    "electionId": electionConfigsSeed.get(electionKey)._id,
  }
];