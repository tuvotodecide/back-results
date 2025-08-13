/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Transform } from 'class-transformer';
import { Types } from 'mongoose';

/**
 * Transform decorator para convertir string a ObjectId
 */
export const TransformObjectId = () =>
  Transform(
    ({ value }) => (value ? new Types.ObjectId(value as string) : undefined),
    {
      toClassOnly: true,
    },
  );
