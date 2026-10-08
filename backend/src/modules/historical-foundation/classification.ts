/**
 * =============================================================================
 * classification.ts — HISTORICAL DATA FOUNDATION, PHASE 1 (CLASSIFICATION)
 * =============================================================================
 *
 * The code-level classification of EVERY live collection in the ChitKuber
 * MongoDB (`pos`). Executable form of STEP 5 of the master prompt: each business
 * domain gets exactly ONE action from a closed set, plus the historical status,
 * tenant/branch scoping, the writer, the readers, and the product surfaces.
 *
 * Pure data + pure helpers. NO I/O, NO writes, NO behaviour change.
 *
 * `LIVE_COLLECTIONS` is a read-only snapshot of `listCollections()` taken on
 * 2026-10-08 (128 collections). The Phase 1 coverage test asserts the registry
 * classifies every one of them, so a newly-added collection fails the test until
 * it is deliberately classified (never silently ignored).
 */

import type {
  DataStatus,
  HistoricalAction,
  ProductSurface,
} from './dataContract';

/** Snapshot of live collections at audit time (2026-10-08). */
export const LIVE_COLLECTIONS_SNAPSHOT: readonly string[] = [
  'advisorrecommendations', 'aibillingrecords', 'aiquotasnapshots', 'aiusagelogs',
  'auditalerts', 'auditchainmetas', 'auditexportjobs', 'auditlegalholds', 'auditlogarchives',
  'auditlogs', 'auditsavedsearches', 'authorizations', 'billitems', 'bills', 'blockedips',
  'branches', 'branchsettings', 'calendarevents', 'campaignhistories', 'campaignproposals',
  'campaigns', 'cashledgers', 'configurationtemplates', 'consentrecords', 'costsettings',
  'couponredemptions', 'customeractivities', 'customerrequests', 'customers',
  'customersegments', 'customervisits', 'dailysummaries', 'dailysummaryevidences',
  'datasubjectrequests', 'deviceactivities', 'devices', 'employees', 'expensecategories',
  'expenses', 'feedbackanalyses', 'feedbackinsights', 'financesettings', 'floors', 'forecasts',
  'heldorders', 'helpviews', 'inactiverestaurantsnapshots', 'intelligencesignals',
  'inventoryevents', 'invoicecounters', 'invoices', 'itemaliases', 'kotrecords',
  'learningsignals', 'legalacceptances', 'legaldocuments', 'licenses', 'loyaltysettings',
  'loyaltytiers', 'loyaltytransactions', 'marketingautomations', 'memoryepisodes',
  'menuavailabilities', 'mlpredictionoutcomes', 'mlpredictions', 'monthlysummaries',
  'offeralytics', 'offeranalytics', 'offerexperimentevents', 'offerexperiments', 'offers',
  'orderadjustments', 'ordercounters', 'orderitems', 'orders', 'otprequests', 'payments',
  'platformevents', 'printers', 'products', 'productvariants', 'promotioncandidates',
  'promotions', 'purchases', 'qrorderingsessions', 'qrtokens', 'receiptfeedbacks',
  'recipeconsumptions', 'recipes', 'recipeversions', 'recommendationoutcomes',
  'recurringexpenses', 'referrals', 'refreshtokens', 'refundrecords', 'refunds',
  'reportexportjobs', 'reportsnapshots', 'reservations', 'restaurantmemories', 'restaurants',
  'restaurantsettings', 'restaurantssettings', 'revenueevents', 'rewards', 'settings',
  'stockoutrisks', 'sttusages', 'subscriptionhistories', 'subscriptionplans', 'subscriptions',
  'suppliers', 'supporttickets', 'tables', 'takeawayorders', 'ticketcounters', 'ticketreplies',
  'timelineevents', 'users', 'vendors', 'voiceauditlogs', 'voicependingactions',
  'waitingentries', 'webhookevents', 'whatsappintegrationhistories', 'whatsappintegrations',
  'whatsappusages', 'yearlysummaries',
] as const;

/** One classified business domain. */
export interface DomainClassification {
  /** Stable domain key (used in reports and later phases). */
  domain: string;
  /** Live collections owned by this domain. */
  collections: string[];
  /** The single required historical action for this domain. */
  action: HistoricalAction;
  /** Dominant historical status of the domain as measured at audit time. */
  status: DataStatus;
  /** Restaurant-scoped data. */
  tenantScoped: boolean;
  /** Branch-scoped data (false = restaurant-wide / unused). */
  branchScoped: boolean;
  /** What writes these collections. */
  writer: string;
  /** Product feature(s) that read them. */
  readers: ProductSurface[];
  /** Whether the domain feeds historical ML datasets. */
  mlRelevant: boolean;
  /** Free-form note, including the reason when an action is not REUSE. */
  note?: string;
}

/**
 * The full classification. Every entry maps 1:1 to a business domain, and the
 * union of `collections` must equal `LIVE_COLLECTIONS_SNAPSHOT` (tested).
 */
export const CLASSIFICATIONS: readonly DomainClassification[] = [
  { domain: 'sales.transactionSpine', collections: ['bills', 'billitems'], action: 'REUSE_EXISTING', status: 'OBSERVED', tenantScoped: true, branchScoped: true, writer: 'billService (POS billing)', readers: ['RestaurantPOS', 'Reports', 'Finance', 'ML'], mlRelevant: true, note: 'Real + sim rows. Per-tenant windows; 78-day global blackout (D9). Never re-seed.' },
  { domain: 'orders', collections: ['orders', 'orderitems', 'kotrecords', 'heldorders', 'takeawayorders', 'orderadjustments', 'ordercounters'], action: 'REUSE_EXISTING', status: 'OBSERVED', tenantScoped: true, branchScoped: true, writer: 'order/KOT services', readers: ['RestaurantPOS', 'Reports', 'ML'], mlRelevant: true },
  { domain: 'payments.refunds', collections: ['payments', 'cashledgers', 'refundrecords', 'refunds'], action: 'COLLECT_GOING_FORWARD', status: 'UNAVAILABLE', tenantScoped: true, branchScoped: true, writer: 'billing close / refund flow', readers: ['Finance', 'Reports'], mlRelevant: false, note: 'refunds = 0 rows historically; payments embedded in Bill.payments[]. Begin capturing going forward.' },
  { domain: 'finance', collections: ['invoices', 'invoicecounters', 'dailysummaries', 'dailysummaryevidences', 'monthlysummaries', 'yearlysummaries', 'expenses', 'expensecategories', 'recurringexpenses', 'financesettings', 'reportsnapshots', 'revenueevents'], action: 'REUSE_EXISTING', status: 'OBSERVED', tenantScoped: true, branchScoped: true, writer: 'analyticsService / finance services', readers: ['Finance', 'Reports', 'AdminPOS', 'ML'], mlRelevant: true, note: 'Daily facts need timezone-correct businessDate (D5, Phase 3).' },
  { domain: 'products.menu', collections: ['products', 'productvariants', 'itemaliases', 'menuavailabilities', 'costsettings'], action: 'REUSE_EXISTING', status: 'OBSERVED', tenantScoped: true, branchScoped: true, writer: 'menu admin', readers: ['RestaurantPOS', 'Reports', 'ML'], mlRelevant: true, note: 'Historical pricing reused from BillItem/OrderItem snapshots, never today\'s values.' },
  { domain: 'recipes.cost', collections: ['recipes', 'recipeversions', 'recipeconsumptions'], action: 'RECONSTRUCT', status: 'UNAVAILABLE', tenantScoped: true, branchScoped: false, writer: 'recipe editor / consumption capture', readers: ['Inventory', 'Finance', 'ML'], mlRelevant: true, note: 'Only 3 RecipeVersion rows → historical cost = null before 2026-04. NEVER substitute today\'s cost (prompt §18/§34).' },
  { domain: 'inventory', collections: ['suppliers', 'vendors', 'purchases', 'inventoryevents'], action: 'REUSE_EXISTING', status: 'OBSERVED', tenantScoped: true, branchScoped: true, writer: 'inventory module / purchases', readers: ['Inventory', 'Reports', 'ML'], mlRelevant: true },
  { domain: 'floorTables', collections: ['floors', 'tables', 'waitingentries', 'reservations'], action: 'LEAVE_OPERATIONAL_ONLY', status: 'PARTIAL', tenantScoped: true, branchScoped: true, writer: 'floor/reservation services', readers: ['RestaurantPOS'], mlRelevant: false, note: 'Operational seating; not part of the historical fact model.' },
  { domain: 'customers', collections: ['customers', 'customervisits', 'customersegments', 'customeractivities', 'customerrequests', 'referrals'], action: 'REUSE_EXISTING', status: 'OBSERVED', tenantScoped: true, branchScoped: true, writer: 'CRM / segment engine / customer site', readers: ['RestaurantPOS', 'CustomerSite', 'Marketing', 'ML'], mlRelevant: true, note: '64.7% identified; anonymous bills stay anonymous (prompt §15/§35).' },
  { domain: 'loyalty', collections: ['loyaltytransactions', 'loyaltytiers', 'loyaltysettings', 'rewards'], action: 'RECONSTRUCT', status: 'PARTIAL', tenantScoped: true, branchScoped: false, writer: 'loyalty services', readers: ['RestaurantPOS', 'CustomerSite', 'ML'], mlRelevant: true, note: 'Ledger starts 2026-06-18; reconstruct as-of-date balance only where the ledger is reliable.' },
  { domain: 'marketing', collections: ['offers', 'campaigns', 'campaignhistories', 'campaignproposals', 'couponredemptions', 'offeranalytics', 'offeralytics', 'marketingautomations', 'promotioncandidates', 'promotions'], action: 'REUSE_EXISTING', status: 'OBSERVED', tenantScoped: true, branchScoped: true, writer: 'marketing / offer services', readers: ['Marketing', 'RestaurantPOS', 'Reports', 'ML'], mlRelevant: true, note: 'offeralytics vs offeranalytics + restaurantsettings vs restaurantssettings are duplicates (D4) — REPORTED, not changed.' },
  { domain: 'experiments.causal', collections: ['offerexperiments', 'offerexperimentevents'], action: 'BACKFILL_MISSING', status: 'PARTIAL', tenantScoped: true, branchScoped: false, writer: 'experiments module', readers: ['Marketing', 'ML'], mlRelevant: true, note: 'Events exist (window closed 2026-03-29, 8:1 imbalance); definitions = 0 → do NOT fabricate. Never call observational redemption causal uplift (prompt §22/§23/§36).' },
  { domain: 'feedback', collections: ['receiptfeedbacks', 'feedbackanalyses', 'feedbackinsights'], action: 'BACKFILL_MISSING', status: 'PARTIAL', tenantScoped: true, branchScoped: true, writer: 'customer site (receipt feed) + feedbackIntelligenceService', readers: ['RestaurantPOS', 'CustomerSite', 'AI'], mlRelevant: false, note: 'Raw feedback reused (3 months); analyses/insights are DERIVED from real feedback rows — safe to backfill, never fabricated.' },
  { domain: 'context.external', collections: ['calendarevents'], action: 'REUSE_EXISTING', status: 'OBSERVED', tenantScoped: false, branchScoped: false, writer: 'calendar sync', readers: ['Marketing', 'Reports', 'ML'], mlRelevant: true, note: 'Festival/sports context only. Weather/competition has no historical archive → COLLECT_GOING_FORWARD (see mlPredictions own note).' },
  { domain: 'ml.predictions', collections: ['mlpredictions', 'mlpredictionoutcomes', 'forecasts', 'stockoutrisks', 'intelligencesignals', 'learningsignals', 'recommendationoutcomes'], action: 'COLLECT_GOING_FORWARD', status: 'PARTIAL', tenantScoped: true, branchScoped: false, writer: 'ml-pipeline (predictionService)', readers: ['ML', 'AI', 'AdminPOS'], mlRelevant: true, note: 'mlpredictions has an ACTIVE TTL (D3) and mlpredictionoutcomes = 0 → preserve evaluation evidence going forward (Phase 16).' },
  { domain: 'ai.memory.ops', collections: ['aiusagelogs', 'aiquotasnapshots', 'memoryepisodes', 'restaurantmemories', 'advisorrecommendations'], action: 'LEAVE_OPERATIONAL_ONLY', status: 'PARTIAL', tenantScoped: true, branchScoped: false, writer: 'AI agents / memory manager', readers: ['AI', 'AdminPOS'], mlRelevant: false },
  { domain: 'observability.audit', collections: ['auditlogs', 'auditalerts', 'auditexportjobs', 'auditlegalholds', 'auditlogarchives', 'auditsavedsearches', 'auditchainmetas', 'timelineevents', 'platformevents', 'deviceactivities', 'devices', 'sttusages', 'voiceauditlogs', 'voicependingactions', 'webhookevents'], action: 'LEAVE_OPERATIONAL_ONLY', status: 'PARTIAL', tenantScoped: true, branchScoped: false, writer: 'audit/timeline/voice/webhook infrastructure', readers: ['Backend', 'AdminPOS'], mlRelevant: false, note: 'Retention service governs auditlogs; not historical business facts.' },
  { domain: 'admin.platform', collections: ['restaurants', 'branches', 'branchsettings', 'restaurantsettings', 'restaurantssettings', 'settings', 'configurationtemplates', 'subscriptions', 'subscriptionhistories', 'subscriptionplans', 'licenses', 'users', 'employees', 'authorizations', 'refreshtokens', 'otprequests', 'supporttickets', 'ticketreplies', 'ticketcounters', 'helpviews', 'aibillingrecords', 'inactiverestaurantsnapshots', 'reportexportjobs', 'whatsappintegrations', 'whatsappintegrationhistories', 'whatsappusages'], action: 'LEAVE_OPERATIONAL_ONLY', status: 'PARTIAL', tenantScoped: true, branchScoped: false, writer: 'admin module / auth / integrations', readers: ['AdminPOS', 'Backend'], mlRelevant: false, note: 'Platform/SaaS billing is SEPARATE from restaurant finance — never mixed (prompt §13).' },
  { domain: 'legal.consent', collections: ['legaldocuments', 'legalacceptances', 'consentrecords', 'datasubjectrequests', 'blockedips'], action: 'LEAVE_OPERATIONAL_ONLY', status: 'PARTIAL', tenantScoped: false, branchScoped: false, writer: 'legal module', readers: ['AdminPOS', 'Backend'], mlRelevant: false },
  { domain: 'qr.print.ops', collections: ['qrtokens', 'qrorderingsessions', 'printers'], action: 'LEAVE_OPERATIONAL_ONLY', status: 'PARTIAL', tenantScoped: true, branchScoped: true, writer: 'qr-ordering / printer services', readers: ['RestaurantPOS', 'CustomerSite'], mlRelevant: false },
];

/** All distinct actions present in the classification (for reporting). */
export function classifiedActions(): HistoricalAction[] {
  return [...new Set(CLASSIFICATIONS.map((c) => c.action))];
}

/** Every collection named by the registry. */
export function classifiedCollections(): string[] {
  return CLASSIFICATIONS.flatMap((c) => c.collections);
}

/** The classification entry that owns `collection`, or undefined. */
export function classifyCollection(collection: string): DomainClassification | undefined {
  return CLASSIFICATIONS.find((c) => c.collections.includes(collection));
}

/** The classification entry for a domain key, or undefined. */
export function findDomain(domain: string): DomainClassification | undefined {
  return CLASSIFICATIONS.find((c) => c.domain === domain);
}

/**
 * Coverage check against the live snapshot. Returns unclassified collections and
 * any collection the registry names that no longer exists. Pure; used by tests
 * and by the Phase 9/10 quality gates.
 */
export function coverageGaps(snapshot: readonly string[] = LIVE_COLLECTIONS_SNAPSHOT): {
  unclassified: string[];
  phantom: string[];
  duplicateOwners: string[];
} {
  const classified = classifiedCollections();
  const owned = new Map<string, number>();
  for (const c of classified) owned.set(c, (owned.get(c) ?? 0) + 1);
  const snapshotSet = new Set(snapshot);
  const ownedSet = new Set(classified);
  return {
    unclassified: snapshot.filter((c) => !ownedSet.has(c)).sort(),
    phantom: classified.filter((c) => !snapshotSet.has(c)).sort(),
    duplicateOwners: [...owned.entries()].filter(([, n]) => n > 1).map(([c]) => c).sort(),
  };
}
