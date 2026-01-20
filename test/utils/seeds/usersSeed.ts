import { Connection } from "mongoose";

export async function seedUsers(conn: Connection) {
  const users = await usersSeed(conn);
  await conn.collection('roled_users').insertMany(Array.from(users.values()));
  return users;
}

// all users passords are 'secret123'
export const usersSeed = async (conn: Connection) => {
  const lapaz = await conn.collection('departments').findOne({ name: 'La Paz' });
  const cbba = await conn.collection('departments').findOne({ name: 'Cochabamba' });

  return new Map<string, any>([
    [
      'notVerifiedEmail',
      {
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
        "votingDepartmentId": lapaz?._id,
        "votingMunicipalityId": null,
      },
    ],[
      'notActive',
      {
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
        "votingDepartmentId": lapaz?._id,
        "votingMunicipalityId": null,
      }
    ],[
      'governorLaPaz',
      {
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
        "votingDepartmentId": lapaz?._id,
        "votingMunicipalityId": null,
      }
    ],[
      'mayorCbba',
      {
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
        "votingDepartmentId": cbba?._id,
        "votingMunicipalityId": null,
      }
    ]
  ]);
};