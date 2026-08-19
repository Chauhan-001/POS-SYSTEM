/**
 * 16-audit.ts — Creates realistic audit log entries.
 */
import { Db, ObjectId } from 'mongodb';
import { SeedContext, oid } from './types';
import { daysAgo, rand, pick } from './helpers';

export async function seedAuditLogs(db: Db, ctx: SeedContext): Promise<void> {
  console.log('📋 Seeding audit logs...');
  const rid = ctx.restaurantId;

  const ACTIONS = [
    'PRODUCT_CREATED', 'PRODUCT_UPDATED', 'PRODUCT_DELETED',
    'PURCHASE_CREATED', 'PURCHASE_RECEIVED',
    'STOCK_ADJUSTED', 'STOCK_WASTAGE',
    'BILL_CREATED', 'BILL_VOIDED',
    'OFFER_CREATED', 'OFFER_ACTIVATED', 'OFFER_PAUSED',
    'CAMPAIGN_SCHEDULED', 'CAMPAIGN_SENT',
    'SETTINGS_UPDATED', 'PRINTER_CONFIGURED',
    'EMPLOYEE_CREATED', 'EMPLOYEE_UPDATED',
    'LOYALTY_REWARD_REDEEMED', 'LOYALTY_POINTS_AWARDED',
    'RESERVATION_CREATED', 'RESERVATION_CANCELLED',
    'USER_LOGIN', 'USER_LOGOUT',
    'BACKUP_CREATED', 'INVOICE_GENERATED',
  ];

  const USERS = ['Vikram Singh', 'Priya Sharma', 'Rahul Verma', 'Amit Kumar', 'system'];

  let count = 0;
  for (let day = 90; day >= 0; day--) {
    const d = daysAgo(day);
    const numLogs = rand(3, 12);
    for (let i = 0; i < numLogs; i++) {
      await db.collection('auditlogs').insertOne({
        _id: oid(), restaurantId: rid,
        action: pick(ACTIONS),
        entityType: pick(['Product', 'Bill', 'Offer', 'Campaign', 'Settings', 'Employee', 'Reservation', 'Purchase']),
        entityId: oid().toString(),
        performedBy: pick(USERS),
        performedById: null,
        branchId: pick(ctx.branchIds),
        ipAddress: `192.168.1.${rand(10, 200)}`,
        details: { action: pick(ACTIONS), source: 'pos' },
        createdAt: d, updatedAt: d,
      });
      count++;
    }
  }

  console.log(`   ✅ Audit logs: ${count}`);
}
