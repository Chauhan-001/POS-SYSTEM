/**
 * API — Branches (per-Restaurant)
 *
 * Endpoints:
 *   GET  /admin/restaurants/:id/branch-usage → getBranchUsageByRestaurant()
 *
 * Returns branch usage stats and the list of branches for a given restaurant,
 * including plan limits, active counts, and per-branch details.
 */

import apiClient from './client'

export interface BranchUsageResponse {
  plan: string
  maxBranches: number
  usage: {
    totalBranches: number
    activeBranches: number
    remainingBranches: number | string
  }
  branches: Array<{
    id: string
    name: string
    status: string
    isHeadBranch: boolean
    employees: number
    tables: number
  }>
}

export async function getBranchUsageByRestaurant(restaurantId: string): Promise<BranchUsageResponse> {
  const { data } = await apiClient.get(`/api/admin/restaurants/${restaurantId}/branch-usage`)
  return data
}
