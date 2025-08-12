/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Transform } from 'class-transformer';
import { Types } from 'mongoose';

/**
 * Transform decorator para convertir string a ObjectId
 */
export const TransformObjectId = () =>
  Transform(({ value }) => {
    if (value instanceof Types.ObjectId) {
      return value;
    }
    if (typeof value === 'string' && Types.ObjectId.isValid(value)) {
      return new Types.ObjectId(value);
    }
    return value;
  });
