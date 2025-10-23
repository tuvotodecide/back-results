// test/utils/mongo.ts
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

export class InMemoryMongo {
  private server!: MongoMemoryServer;
  public uri!: string;

  async start() {
    this.server = await MongoMemoryServer.create();
    this.uri = this.server.getUri();   // ❗ NO conectes aquí con mongoose
    return this.uri;
  }

  async stop() {
    const conn = mongoose.connection;
    if (conn.readyState !== 0) {       // 0 = disconnected
      await conn.dropDatabase();
      await conn.close();
    }
    await this.server.stop();
  }

  async clear() {
    const conn = mongoose.connection;
    if (conn.readyState === 1) {       // 1 = connected
      const { collections } = conn;
      for (const name of Object.keys(collections)) {
        await collections[name].deleteMany({});
      }
    }
  }
}
