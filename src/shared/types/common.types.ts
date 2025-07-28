/* eslint-disable prettier/prettier */
export type ObjectId = string;

export interface BaseEntity {
  _id: ObjectId;
  createdAt: Date;
  updatedAt: Date;
  active?: boolean;
}

export interface GeographicEntity extends BaseEntity {
  name: string;
}

export interface PaginationQuery {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}
