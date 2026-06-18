import { Schema } from 'mongoose';

export interface LockDocument {
  _id: string;          // p.ej. 'resolve:<electionId>'
  owner: string;        // p.ej. 'back-results:dev'
  expiresAt: Date;      // TTL
}

export const LockSchema = new Schema<LockDocument>(
  {
    _id: { type: String, required: true },
    owner: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { collection: 'locks', versionKey: false }
);

// índice TTL (Mongo borra docs cuando expiresAt <= now)
LockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
