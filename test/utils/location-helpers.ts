import { Connection } from "mongoose";
import request from "supertest";

export async function login(server: any, email: string, password: string): Promise<string> {
  let res = await request(server)
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);

  return res.body.accessToken;
}


export type TableInfo = {
  _id: string;
  tableNumber: string;
  tableCode: string;
  electoralLocationId: string;
}
export async function getTablesForMunicipality(
  conn: Connection,
  municipalityName: string,
  count: number
) {
  const tables = await conn.collection('electoral_tables').aggregate<TableInfo>([
    {
      $lookup: {
        from: "electoral_locations",
        localField: "electoralLocationId",
        foreignField: "_id",
        as: "electoral_location"
      }
    },
    {
      $unwind: "$electoral_location"
    },
    {
      $lookup: {
        from: "electoral_seats",
        localField:
          "electoral_location.electoralSeatId",
        foreignField: "_id",
        as: "electoral_seat"
      }
    },
    {
      $unwind: "$electoral_seat"
    },
    {
      $lookup: {
        from: "municipalities",
        localField: "electoral_seat.municipalityId",
        foreignField: "_id",
        as: "municipality"
      }
    },
    {
      $unwind: "$municipality"
    },
    {
      $match: {
        "municipality.name": municipalityName
      }
    },{
      $limit: count
    },
    {
      $project: {
        _id: 1,
        tableNumber: 1,
        tableCode: 1,
        electoralLocationId: 1
      }
    }
  ]).toArray();

  return tables;
}

export async function getTablesForDepartment(
  conn: Connection,
  departmentName: string,
  count: number
) {
  const tables = await conn.collection('electoral_tables').aggregate<TableInfo>([
    {
      $lookup: {
        from: "electoral_locations",
        localField: "electoralLocationId",
        foreignField: "_id",
        as: "electoral_location"
      }
    },
    {
      $unwind: "$electoral_location"
    },
    {
      $lookup: {
        from: "electoral_seats",
        localField:
          "electoral_location.electoralSeatId",
        foreignField: "_id",
        as: "electoral_seat"
      }
    },
    {
      $unwind: "$electoral_seat"
    },
    {
      $lookup: {
        from: "municipalities",
        localField: "electoral_seat.municipalityId",
        foreignField: "_id",
        as: "municipality"
      }
    },
    {
      $unwind: "$municipality"
    },
    {
      $lookup: {
        from: "provinces",
        localField: "municipality.provinceId",
        foreignField: "_id",
        as: "province"
      }
    },
    {
      $unwind: "$province"
    },
    {
      $lookup: {
        from: "departments",
        localField: "province.departmentId",
        foreignField: "_id",
        as: "department"
      }
    },
    {
      $unwind: "$department"
    },
    {
      $match: {
        "department.name": departmentName,
      }
    },{
      $limit: count
    },
    {
      $project: {
        _id: 1,
        tableNumber: 1,
        tableCode: 1,
        electoralLocationId: 1
      }
    }
  ]).toArray();

  return tables;
}