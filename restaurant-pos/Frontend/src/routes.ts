/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Route configuration — maps workspace names to URL paths and vice versa.
 * Used by the App component to sync activeWorkspace ↔ browser URL.
 */

/** All workspace names in the POS system */
export type WorkspaceName =
  | 'Dashboard'
  | 'Orders'
  | 'Billing'
  | 'Products'
  | 'Customers'
  | 'Offers'
  | 'Reports'
  | 'Staff'
  | 'Branches'
  | 'Settings'
  | 'ReceiptHistory'
  | 'Expenses'
  | 'Reservations'
  | 'Analytics'
  | 'Finance'
  | 'Inventory'
  | 'Kitchen'
  | 'More';

/** Default workspace when no route matches */
export const DEFAULT_WORKSPACE: WorkspaceName = 'Dashboard';

/** Workspace → URL path mapping (lowercase, kebab-style) */
export const WORKSPACE_PATHS: Record<WorkspaceName, string> = {
  Dashboard: '/dashboard',
  Orders: '/orders',
  Billing: '/billing',
  Products: '/products',
  Customers: '/customers',
  Offers: '/offers',
  Reports: '/reports',
  Staff: '/staff',
  Branches: '/branches',
  Settings: '/settings',
  ReceiptHistory: '/receipt-history',
  Expenses: '/expenses',
  Reservations: '/reservations',
  Analytics: '/analytics',
  Finance: '/finance',
  Inventory: '/inventory',
  Kitchen: '/kitchen',
  More: '/more',
};

/** Reverse map: URL path → WorkspaceName */
const PATH_TO_WORKSPACE: Record<string, WorkspaceName> = {};
for (const [ws, path] of Object.entries(WORKSPACE_PATHS)) {
  PATH_TO_WORKSPACE[path] = ws as WorkspaceName;
}

/** Convert a URL path (e.g. "/orders") to a workspace name */
export function pathToWorkspace(path: string): WorkspaceName {
  return PATH_TO_WORKSPACE[path] ?? DEFAULT_WORKSPACE;
}

/** Convert a workspace name to its URL path */
export function workspaceToPath(ws: string): string {
  return WORKSPACE_PATHS[ws as WorkspaceName] ?? '/dashboard';
}
