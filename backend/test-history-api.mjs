import mongoose from 'mongoose';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
process.env.DOTENV_CONFIG_QUIET = 'true';
dotenv.config();

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/pos';
const BASE = 'http://localhost:3002/api';
const secret = process.env.JWT_SECRET || 'dev-secret';
const issuer = process.env.JWT_ISSUER || 'restaurant-pos';
const RID = '6a6b931daac9c850389c5b50'; // Test Restaurant

await mongoose.connect(uri);
const db = mongoose.connection.db;

// Baseline before the test
const docBefore = await db.collection('restaurantsettings').findOne({ restaurantId: new mongoose.Types.ObjectId(RID) });
const baselineVersion = docBefore?.settingsVersion ?? 0;
const baselineHistory = (docBefore?.history || []).length;
const baselineAudit = await db.collection('auditlogs').countDocuments({ restaurantId: new mongoose.Types.ObjectId(RID), $or: [{ entityType: 'RestaurantSettings' }, { entityType: 'restaurantsettings' }, { entityType: 'settings' }, { action: { $regex: '^SETTINGS_' } }] });
console.log(`BASELINE  version=${baselineVersion}  history=${baselineHistory}  settingsAudit=${baselineAudit}`);

const token = jwt.sign({ userId: 'test_driver', restaurantId: RID, role: 'owner', name: 'Auto Test', employeeId: null, branchIds: [] }, secret, { expiresIn: '1h', issuer });
const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };

// Save #1
console.log('\nSAVE 1 (AUTO-TEST save 1)...');
let r = await fetch(`${BASE}/settings`, { method: 'PATCH', headers: auth, body: JSON.stringify({ scope: 'restaurant', settings: { autoTestMarker: true }, changeReason: 'AUTO-TEST save 1' }) });
console.log('  ->', r.status, JSON.stringify(await j(r)));

// Save #2
console.log('SAVE 2 (AUTO-TEST save 2)...');
r = await fetch(`${BASE}/settings`, { method: 'PATCH', headers: auth, body: JSON.stringify({ scope: 'restaurant', settings: { autoTestMarker: false }, changeReason: 'AUTO-TEST save 2' }) });
console.log('  ->', r.status, JSON.stringify(await j(r)));

// History now
console.log('\nHISTORY after 2 saves:');
r = await fetch(`${BASE}/settings/history?scope=restaurant`, { headers: auth });
const h = await j(r);
console.log('  currentVersion:', h.settingsVersion, '| entries:', h.history?.length);
for (const e of h.history || []) console.log('   - v' + e.version, '|', e.changeReason || '(no reason)', '|', e.updatedBy, '|', e.updatedAt?.slice?.(0, 19));

// Audit now
console.log('\nAUDIT after 2 saves:');
r = await fetch(`${BASE}/settings/audit?page=1&limit=10`, { headers: auth });
const a = await j(r);
console.log('  total:', a.total);
for (const e of a.data || []) console.log('   -', e.action, '|', e.performedBy, '| scope', e.details?.scope, '| v', e.details?.version, '| changedKeys', JSON.stringify(e.details?.changedKeys || []));

// Rollback to version 1 (restores original empty settings)
console.log('\nROLLBACK to v1...');
r = await fetch(`${BASE}/settings/rollback`, { method: 'POST', headers: auth, body: JSON.stringify({ scope: 'restaurant', toVersion: 1, changeReason: 'AUTO-TEST rollback (restore original)' }) });
console.log('  ->', r.status, JSON.stringify(await j(r)));

// History after rollback
console.log('\nHISTORY after rollback:');
r = await fetch(`${BASE}/settings/history?scope=restaurant`, { headers: auth });
const h2 = await j(r);
console.log('  currentVersion:', h2.settingsVersion, '| entries:', h2.history?.length);
for (const e of h2.history || []) console.log('   - v' + e.version, '|', e.changeReason || '(no reason)');

// Audit after rollback
console.log('\nAUDIT after rollback:');
r = await fetch(`${BASE}/settings/audit?page=1&limit=10`, { headers: auth });
const a2 = await j(r);
console.log('  total:', a2.total);
for (const e of a2.data || []) console.log('   -', e.action, '|', e.performedBy);

// Final DB state
const docAfter = await db.collection('restaurantsettings').findOne({ restaurantId: new mongoose.Types.ObjectId(RID) });
console.log('\nFINAL  version=', docAfter?.settingsVersion, '| settings=', JSON.stringify(docAfter?.settings || {}), '| historyEntries=', (docAfter?.history || []).length);
console.log('  settings restored to original:', JSON.stringify(docAfter?.settings || {}) === JSON.stringify(docBefore?.settings || {}));

await mongoose.disconnect();
