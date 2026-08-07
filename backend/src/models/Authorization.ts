/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Authorization Model — Collection-level access control.
 *
 * Each document defines which roles/users can perform which operations
 * on a specific MongoDB collection within a restaurant context.
 *
 * This provides a granular authorization layer beyond JWT role checks,
 * enabling per-collection CRUD permissions for super_admin accounts
 * managing the platform via the Admin Dashboard.
 */

import mongoose, { Schema, Document } from 'mongoose';

export type AuthorizationAction = 'create' | 'read' | 'update' | 'delete' | 'admin';

export interface IAuthorization extends Document {
  /** The user or role this authorization applies to */
  principalId: mongoose.Types.ObjectId;
  /** Whether the principal is a specific user or a role name */
  principalType: 'user' | 'role';
  /** The target MongoDB collection name (e.g. 'Restaurant', 'User', 'Subscription') */
  targetCollection: string;
  /** Allowed actions on this collection */
  actions: AuthorizationAction[];
  /** Optional restaurant scope — empty means global access */
  restaurantId?: mongoose.Types.ObjectId;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const AuthorizationSchema = new Schema<IAuthorization>(
  {
    principalId: { type: Schema.Types.ObjectId, required: true, index: true },
    principalType: {
      type: String,
      required: true,
      enum: ['user', 'role'],
      index: true,
    },
    targetCollection: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    actions: [{
      type: String,
      enum: ['create', 'read', 'update', 'delete', 'admin'],
    }],
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

AuthorizationSchema.index({ principalId: 1, targetCollection: 1 }, { unique: true });
AuthorizationSchema.index({ principalType: 1, targetCollection: 1 });

export default mongoose.model<IAuthorization>('Authorization', AuthorizationSchema);
