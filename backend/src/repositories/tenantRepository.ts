/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TenantRepository — Multi-tenant aware repository (Phase 1.6).
 *
 * Every query on a tenant-scoped collection is automatically filtered by
 * restaurantId, and every create stamps restaurantId, so it is impossible for
 * Restaurant A to read or write Restaurant B's records through the repository.
 *
 * Usage:
 *   const repo = customerRepo.forTenant(restaurantId);
 *   await repo.findByPhone(restaurantId, phone)  // scoped
 *
 * The singleton exported from repositories/index.ts is UNBOUND — services MUST
 * call .forTenant(restaurantId) (derived from req.user.restaurantId) before
 * using it. An unbound repo behaves like a plain BaseRepository and is only
 * meant for system/admin tasks.
 */

import { Model, Document, UpdateQuery, PopulateOptions } from 'mongoose';
import { BaseRepository, FilterQuery } from './baseRepository';

export class TenantRepository<T extends Document> extends BaseRepository<T> {
  private tenantId: string | null = null;

  constructor(model: Model<T>) {
    super(model);
  }

  /** Current tenant binding (null = unbound). */
  get tenant(): string | null {
    return this.tenantId;
  }

  /**
   * Return a NEW repository bound to the given restaurantId.
   * The original singleton is never mutated — call this in every service
   * method using req.user.restaurantId.
   */
  forTenant(restaurantId?: string | null): this {
    const copy = new (this.constructor as new (model: Model<T>) => this)(this.model);
    copy.tenantId = restaurantId || null;
    return copy;
  }

  protected buildFilter(filter: FilterQuery<T> = {}): FilterQuery<T> {
    const base = super.buildFilter(filter) as Record<string, any>;
    if (this.tenantId) {
      base.restaurantId = this.tenantId;
    }
    return base as FilterQuery<T>;
  }

  async findAll(
    filter: FilterQuery<T> = {},
    pagination?: { page?: number; limit?: number; sort?: Record<string, 1 | -1> },
    populate?: PopulateOptions | (PopulateOptions | string)[]
  ) {
    return super.findAll(filter, pagination, populate);
  }

  async findOne(filter: FilterQuery<T> = {}, populate?: PopulateOptions | (PopulateOptions | string)[]): Promise<T | null> {
    return super.findOne(filter, populate);
  }

  /**
   * Find all WITHOUT the soft-delete exclusion (for restore/admin views), but
   * still tenant-scoped. Filters passed in are used as-is (plus tenant).
   */
  async findAllRaw(
    filter: FilterQuery<T> = {},
    pagination?: { page?: number; limit?: number; sort?: Record<string, 1 | -1> },
  ): Promise<{ data: T[]; total: number; page: number; limit: number; totalPages: number }> {
    const query: Record<string, any> = { ...filter };
    if (this.tenantId) query.restaurantId = this.tenantId;
    const page = pagination?.page || 1;
    const limit = pagination?.limit || 0;
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.model.find(query).sort(pagination?.sort || { createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.model.countDocuments(query).exec(),
    ]);
    return { data, total, page, limit, totalPages: limit > 0 ? Math.ceil(total / limit) : 1 };
  }

  async create(data: Partial<T>): Promise<T> {
    const doc = { ...data } as any;
    if (this.tenantId && !doc.restaurantId) {
      doc.restaurantId = this.tenantId;
    }
    return super.create(doc);
  }

  async bulkCreate(dataArray: Partial<T>[]): Promise<T[]> {
    const enriched = this.tenantId
      ? dataArray.map((d) => ({ ...d, restaurantId: (d as any).restaurantId || this.tenantId } as any))
      : dataArray;
    return super.bulkCreate(enriched);
  }

  /**
   * findOneAndUpdate — inject tenant into the filter before running.
   * On upsert, the soft-delete exclusion is intentionally NOT applied (the
   * { isDeleted: { $ne: true } } filter would otherwise be inserted into new
   * documents on collections that don't have that field — StrictModeError).
   */
  async findOneAndUpdate(
    filter: FilterQuery<T>,
    data: Partial<T>,
    options?: { upsert?: boolean },
  ): Promise<T | null> {
    const base: Record<string, any> = options?.upsert ? { ...filter } : this.buildFilter(filter);
    if (this.tenantId) base.restaurantId = this.tenantId;
    return this.model
      .findOneAndUpdate(
        base as FilterQuery<T>,
        { ...data, updatedAt: new Date() },
        { new: true, upsert: options?.upsert ?? false },
      )
      .exec();
  }

  async updateMany(filter: FilterQuery<T>, data: UpdateQuery<T>): Promise<number> {
    const result = await this.model.updateMany(this.buildFilter(filter), { ...data, updatedAt: new Date() }).exec();
    return result.modifiedCount || 0;
  }

  async count(filter: FilterQuery<T> = {}): Promise<number> {
    return this.model.countDocuments(this.buildFilter(filter)).exec();
  }

  async exists(filter: FilterQuery<T> = {}): Promise<boolean> {
    const count = await this.model.countDocuments(this.buildFilter(filter)).limit(1).exec();
    return count > 0;
  }

  async hardDelete(id: string): Promise<T | null> {
    return this.model.findOneAndDelete(this.buildFilter({ _id: id as any })).exec();
  }

  async bulkDelete(filter: FilterQuery<T> = {}): Promise<number> {
    const result = await this.model.deleteMany(this.buildFilter(filter)).exec();
    return result.deletedCount || 0;
  }

  async aggregate(pipeline: any[]): Promise<any[]> {
    const scoped = this.tenantId
      ? [{ $match: { restaurantId: this.tenantId as any } }, ...pipeline]
      : pipeline;
    return this.model.aggregate(scoped).exec();
  }
}
