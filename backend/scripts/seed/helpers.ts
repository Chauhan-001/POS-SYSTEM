/**
 * Shared helpers for the seed system.
 */
import { Db, ObjectId } from 'mongodb';
import { SeedContext } from './types';

export function oid(): ObjectId { return new ObjectId(); }
export function daysAgo(n: number): Date { return new Date(Date.now() - n * 86400000); }
export function rand(min: number, max: number): number { return Math.floor(Math.random() * (max - min + 1)) + min; }
export function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
export function pickN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(n, arr.length));
}
export function round2(n: number): number { return Math.round(n * 100) / 100; }
export function todayStr(): string { return new Date().toISOString().slice(0, 10); }
export function dateStr(d: Date): string { return d.toISOString().slice(0, 10); }
export function timeStr(d: Date): string { return d.toTimeString().slice(0, 5); }

export function randomPhone(): string {
  return '9' + String(rand(100000000, 999999999));
}

export function randomDateInRange(start: Date, end: Date): Date {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

/** Hourly distribution: peaks at 12-14 (lunch) and 19-22 (dinner). */
export function restaurantHour(): number {
  const r = Math.random();
  if (r < 0.30) return rand(12, 14);      // lunch rush 30%
  if (r < 0.60) return rand(19, 22);      // dinner rush 30%
  if (r < 0.75) return rand(11, 12);      // pre-lunch 15%
  if (r < 0.85) return rand(15, 18);      // afternoon 10%
  if (r < 0.92) return rand(8, 11);       // morning 7%
  return rand(22, 23);                     // late evening 8%
}

/** Day of week weight: weekends are busier. */
export function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

export async function collectionCount(db: Db, name: string): Promise<number> {
  try { return await db.collection(name).countDocuments(); } catch { return 0; }
}
