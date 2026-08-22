/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Base Repository — Generic CRUD operations for all Mongoose models.
 * All domain repositories extend this to inherit common operations.
 *
 * Following the architecture pattern:
 *   Routes → Controllers → Services → Repositories → Models
 *
 * Repositories ONLY handle database logic.
 * Business logic belongs in Services.
 *
 * Each operation supports optional restaurantId filtering for multi-tenant isolation.
 * Soft-deleted records (isDeleted = true) are excluded by default.
 * Use `includeDeleted()` to include them when needed.
 */

import { Model, Document, UpdateQuery, PopulateOptions } from 'mongoose';

/** FilterQuery type alias for Mongoose v9 (type not directly exported) */
export type FilterQuery<T> = { [P in keyof T]?: any } & Record<string, any>;

export interface PaginationParams {
  page?: number;
  limit?: number;
  sort?: Record<string, 1 | -1>;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export class BaseRepository<T extends Document> {
  constructor(protected model: Model<T>) {}

  /**
   * Build a filter query that excludes soft-deleted records by default.
   * Override in subclasses to add tenant filtering (e.g., restaurantId).
   */
  protected buildFilter(filter: FilterQuery<T> = {}): FilterQuery<T> {
    return { ...filter, isDeleted: { $ne: true } };
  }

  /**
   * Find all records matching the filter, with optional pagination.
   */
  async findAll(
    filter: FilterQuery<T> = {},
    pagination?: PaginationParams,
    populate?: PopulateOptions | (PopulateOptions | string)[],
    projection?: Record<string, 0 | 1> | string
  ): Promise<PaginatedResult<T>> {
    const query = this.buildFilter(filter);
    const page = pagination?.page || 1;
    const limit = pagination?.limit || 0;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.model
        .find(query)
        .sort(pagination?.sort || { createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate(populate || [])
        .select(projection || {})
        .exec(),
      this.model.countDocuments(query).exec(),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: limit > 0 ? Math.ceil(total / limit) : 1,
    };
  }

  /**
   * Find a single record by ID.
   */
  async findById(id: string, populate?: PopulateOptions | (PopulateOptions | string)[]): Promise<T | null> {
    return this.model
      .findOne(this.buildFilter({ _id: id as any }))
      .populate(populate || [])
      .exec();
  }

  /**
   * Find a single record matching the filter.
   */
  async findOne(filter: FilterQuery<T> = {}, populate?: PopulateOptions | (PopulateOptions | string)[]): Promise<T | null> {
    return this.model
      .findOne(this.buildFilter(filter))
      .populate(populate || [])
      .exec();
  }

  /**
   * Create a new record.
   */
  async create(data: Partial<T>): Promise<T> {
    const doc = new this.model({
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return doc.save();
  }

  /**
   * Update a record by ID (partial update).
   */
  async update(id: string, data: UpdateQuery<T>): Promise<T | null> {
    return this.model
      .findOneAndUpdate(
        this.buildFilter({ _id: id as any }),
        { ...data, updatedAt: new Date() },
        { new: true }
      )
      .exec();
  }

  /**
   * Find a document and update it atomically, with upsert option.
   */
  async findOneAndUpdate(
    filter: FilterQuery<T>,
    data: Partial<T>,
    options?: { upsert?: boolean },
  ): Promise<T | null> {
    return this.model
      .findOneAndUpdate(
        filter,
        { ...data, updatedAt: new Date() },
        { new: true, upsert: options?.upsert ?? false },
      )
      .exec();
  }

  /**
   * Update multiple records matching the filter.
   */
  async updateMany(filter: FilterQuery<T>, data: UpdateQuery<T>): Promise<number> {
    const result = await this.model
      .updateMany(filter, { ...data, updatedAt: new Date() })
      .exec();
    return result.modifiedCount || 0;
  }

  /**
   * Soft-delete a record by ID (sets isDeleted = true, deletedAt = now).
   */
  async softDelete(id: string): Promise<T | null> {
    return this.model
      .findOneAndUpdate(
        this.buildFilter({ _id: id as any }),
        { isDeleted: true, deletedAt: new Date(), updatedAt: new Date() },
        { new: true }
      )
      .exec();
  }

  /**
   * Permanently delete a record by ID.
   */
  async hardDelete(id: string): Promise<T | null> {
    return this.model.findOneAndDelete({ _id: id as any }).exec();
  }

  /**
   * Count records matching the filter.
   */
  async count(filter: FilterQuery<T> = {}): Promise<number> {
    return this.model.countDocuments(this.buildFilter(filter)).exec();
  }

  /**
   * Check if any record matches the filter.
   */
  async exists(filter: FilterQuery<T> = {}): Promise<boolean> {
    const count = await this.model.countDocuments(this.buildFilter(filter)).limit(1).exec();
    return count > 0;
  }

  /**
   * Bulk insert multiple records.
   */
  async bulkCreate(dataArray: Partial<T>[]): Promise<T[]> {
    const docs = dataArray.map(data => new this.model(data));
    return this.model.insertMany(docs) as Promise<T[]>;
  }

  /**
   * Bulk delete records matching filter.
   */
  async bulkDelete(filter: FilterQuery<T> = {}): Promise<number> {
    const result = await this.model.deleteMany(this.buildFilter(filter)).exec();
    return result.deletedCount || 0;
  }

  /**
   * Run aggregation pipeline.
   */
  async aggregate(pipeline: any[]): Promise<any[]> {
    return this.model.aggregate(pipeline).exec();
  }
}
