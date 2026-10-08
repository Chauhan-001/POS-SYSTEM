/**
 * historical-foundation — CHITKUBER 1-YEAR HISTORICAL DATA FOUNDATION
 *
 * Phase 1 (data contract + classification) barrel. Additive, no I/O.
 * Later phases (extraction, canonical facts, reconstruction, ML datasets) will
 * add sibling modules here without changing the Phase 1 contract.
 */

export * from './dataContract';
export * from './businessDay';
export * from './derive';
export * from './classification';
