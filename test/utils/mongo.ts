
import { Department, DepartmentSchema } from '@/modules/geographic/schemas/department.schema';
import { ElectoralLocation, ElectoralLocationSchema } from '@/modules/geographic/schemas/electoral-location.schema';
import { ElectoralSeat, ElectoralSeatSchema } from '@/modules/geographic/schemas/electoral-seat.schema';
import { ElectoralTable, ElectoralTableSchema } from '@/modules/geographic/schemas/electoral-table.schema';
import { Municipality, MunicipalitySchema } from '@/modules/geographic/schemas/municipality.schema';
import { Province, ProvinceSchema } from '@/modules/geographic/schemas/province.schema';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

export class InMemoryMongo {
  private server!: MongoMemoryServer;
  public uri!: string;

  async start() {
    this.server = await MongoMemoryServer.create();
    this.uri = this.server.getUri();  
    return this.uri;
  }

  async stop() {
    const conn = mongoose.connection;
    if (conn.readyState !== 0) {       
      await conn.dropDatabase();
      await conn.close();
    }
    await this.server.stop();
  }

  async clear() {
    const conn = mongoose.connection;
    if (conn.readyState === 1) {     
      const { collections } = conn;
      for (const name of Object.keys(collections)) {
        await collections[name].deleteMany({});
      }
    }
  }
}

// Useful for tests that require location data, make seeding faster
export const mongoLocationFeatures = [
  { name: Department.name, schema: DepartmentSchema  },
  { name: Province.name, schema: ProvinceSchema  },
  { name: Municipality.name, schema: MunicipalitySchema },
  { name: ElectoralSeat.name, schema: ElectoralSeatSchema },
  { name: ElectoralLocation.name, schema: ElectoralLocationSchema },
  { name: ElectoralTable.name, schema: ElectoralTableSchema },
];