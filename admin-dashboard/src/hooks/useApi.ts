/**
 * =============================================================================
 *  useApi.ts — React Query Hooks for API Calls
 * =============================================================================
 *
 * Purpose:
 *   Thin wrappers around @tanstack/react-query's useQuery and useMutation.
 *   Provides consistent caching, auto-invalidation, and toast notifications.
 *
 * Hooks:
 *   useApiQuery     — GET requests with caching (uses useQuery)
 *   useApiMutation  — POST/PUT/DELETE requests (uses useMutation)
 *                     Auto-shows success/error toasts
 *                     Auto-invalidates related queries on success
 *
 * Usage:
 *   const { data, isLoading } = useApiQuery(['restaurants'], () => getRestaurants({}))
 *   const mutation = useApiMutation(payload => createRestaurant(payload), {
 *     invalidateKeys: [['restaurants']],
 *     successMessage: 'Restaurant created',
 *   })
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'

// ─── Query Hook ──────────────────────────────────────────────────

export function useApiQuery<T>(
  key: string[],
  fn: () => Promise<T>,
  options?: { enabled?: boolean },
) {
  return useQuery<T>({
    queryKey: key,
    queryFn: fn,
    ...options,
  })
}

// ─── Mutation Hook ───────────────────────────────────────────────

export function useApiMutation<TData, TPayload>(
  fn: (payload: TPayload) => Promise<TData>,
  options?: {
    invalidateKeys?: string[][]
    successMessage?: string
    onSuccess?: (data: TData) => void
  },
) {
  const queryClient = useQueryClient()
  const { invalidateKeys, successMessage, onSuccess: onSuccessCb } = options || {}

  return useMutation<TData, Error, TPayload>({
    mutationFn: fn,
    onSuccess: async (data) => {
      if (invalidateKeys) {
        for (const key of invalidateKeys) {
          await queryClient.invalidateQueries({ queryKey: key })
        }
      }
      if (successMessage) toast.success(successMessage)
      onSuccessCb?.(data)
    },
    onError: (error) => {
      const message = (error as any)?.response?.data?.message || error.message || 'An error occurred'
      toast.error(message)
    },
  })
}
