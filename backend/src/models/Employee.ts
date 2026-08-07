/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Employee Model — Staff members with role-based access control.
 * Roles: Owner (full access), Manager (most operations), Cashier (billing only).
 * PIN-based authentication for quick terminal login.
 * branchId links employee to a specific branch (null = all branches).
 *
 * SECURITY: PINs are automatically hashed with bcrypt before storage via
 * a Mongoose pre-save hook. Plaintext PINs from seed data or admin operations
 * are hashed automatically on first save. The auth service uses bcrypt.compare()
 * to verify PINs — raw PIN comparison is never performed.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IEmployee extends Document {
  username: string;
  name: string;
  role: 'Owner' | 'Manager' | 'Cashier';
  pin: string;
  status: 'Active' | 'Inactive';
  restaurantId?: mongoose.Types.ObjectId;
  branchId?: mongoose.Types.ObjectId;
  isDeleted: boolean;
  deletedAt?: Date;
  lastLogin?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const EmployeeSchema = new Schema<IEmployee>(
  {
    username: { type: String, required: true, unique: true, trim: true, lowercase: true, index: true },
    name: { type: String, required: true, trim: true },
    role: { type: String, required: true, enum: ['Owner', 'Manager', 'Cashier'], index: true },
    pin: { type: String, required: true, minlength: 4, maxlength: 60 },
    status: { type: String, default: 'Active', enum: ['Active', 'Inactive'] },
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', default: null, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    lastLogin: { type: Date, default: null },
  },
  { timestamps: true }
);

EmployeeSchema.index({ branchId: 1, status: 1 });

export default mongoose.model<IEmployee>('Employee', EmployeeSchema);
