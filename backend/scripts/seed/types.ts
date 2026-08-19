/**
 * Shared types and seed context passed between modules.
 */
import { Db, ObjectId } from 'mongodb';

export interface SeedContext {
  restaurantId: ObjectId;
  restaurantDocId: ObjectId;
  branchIds: ObjectId[];
  branchNames: string[];
  ownerEmployeeId: ObjectId;
  managerEmployeeId: ObjectId;
  cashierEmployeeId: ObjectId;
  chefEmployeeId: ObjectId;
  waiterEmployeeIds: ObjectId[];
}

export interface ProductSeedResult {
  menuItemIds: ObjectId[];       // sellable menu products
  inventoryItemIds: ObjectId[];  // raw inventory products
  comboIds: ObjectId[];          // combo products
  allProductIds: ObjectId[];
  productByName: Map<string, ObjectId>;
  categoryMap: Map<string, ObjectId[]>;
  variantIds: ObjectId[];
}

export interface CustomerSeedResult {
  customerIds: ObjectId[];
  customerPhones: string[];
}

/** Generate a new ObjectId. */
export function oid(): ObjectId {
  return new ObjectId();
}
