import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

type RunDoc = {
  _id: string;               // electionId
  cursor?: number;           // opcional si quisieras usar offset; aquí guardamos metadata libre
  inFlight?: string[];       // opcional: ids en vuelo
  updatedAt: Date;
  lastError?: string | null;
};

@Injectable()
export class ResolverRunsService {
  private coll: any;
  constructor(@InjectConnection() private readonly conn: any) {
    this.coll = this.conn.collection('resolver_runs');
  }
  async load(electionId: string): Promise<RunDoc | null> {
    return this.coll.findOne({ _id: electionId });
  }
  async save(electionId: string, patch: Partial<RunDoc>) {
    await this.coll.updateOne(
      { _id: electionId },
      { $set: { _id: electionId, updatedAt: new Date(), ...patch } },
      { upsert: true },
    );
  }
}
