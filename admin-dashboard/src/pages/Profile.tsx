/**
 * =============================================================================
 *  Profile.tsx — Admin Profile & Password Change Page
 * =============================================================================
 *
 * Features:
 *   - Display admin avatar (initial letter), name, userId, role
 *   - Edit personal information (name)
 *   - Change password form (current + new + confirm)
 *     - Validates new passwords match
 *     - Validates minimum 8 characters
 *
 * Data Sources:
 *   - PUT /api/auth/admin/profile        → Update name
 *   - PUT /api/auth/admin/change-password → Change password
 */

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Camera } from 'lucide-react'
import toast from 'react-hot-toast'
import { Card, CardHeader, CardTitle } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { Button } from '../components/ui/Button'
import { useAuth } from '../context/AuthContext'
import { updateProfile, changePassword } from '../api/auth'

export default function Profile() {
  const { user, updateUser } = useAuth()
  const [name, setName] = useState(user?.name || '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const updateMutation = useMutation({
    mutationFn: () => updateProfile({ name }),
    onSuccess: (data) => { updateUser(data); toast.success('Profile updated') },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to update profile'),
  })

  const passwordMutation = useMutation({
    mutationFn: () => changePassword({ currentPassword, newPassword }),
    onSuccess: () => { toast.success('Password changed successfully'); setCurrentPassword(''); setNewPassword(''); setConfirmPassword('') },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to change password'),
  })

  function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match')
      return
    }
    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    passwordMutation.mutate()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">Profile</h1>
        <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">Manage your account settings</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Personal Information</CardTitle>
        </CardHeader>
        <div className="mb-6 flex items-center gap-4">
          <div className="relative">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary-600 text-2xl font-bold text-white">
              {user?.name?.charAt(0)?.toUpperCase() || 'A'}
            </div>
            <button className="absolute -bottom-1 -right-1 rounded-full bg-surface-200 p-1.5 text-surface-600 hover:bg-surface-300 dark:bg-surface-700 dark:text-surface-300">
              <Camera size={14} />
            </button>
          </div>
          <div>
            <p className="font-medium text-surface-900 dark:text-surface-100">{user?.name}</p>
            <p className="text-sm text-surface-500 dark:text-surface-400">{user?.userId}</p>
            <span className="inline-flex items-center rounded-full bg-primary-100 px-2.5 py-0.5 text-xs font-medium text-primary-700 dark:bg-primary-900/20 dark:text-primary-400">
              {user?.role}
            </span>
          </div>
        </div>

        <div className="space-y-4 max-w-md">
          <Input label="Full Name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input label="User ID" value={user?.userId || ''} disabled helperText="User ID cannot be changed" />
          <div className="flex justify-end">
            <Button onClick={() => updateMutation.mutate()} loading={updateMutation.isPending}>Save Changes</Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Change Password</CardTitle>
        </CardHeader>
        <form onSubmit={handlePasswordSubmit} className="max-w-md space-y-4">
          <Input label="Current Password" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
          <Input label="New Password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
          <Input label="Confirm New Password" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
          <div className="flex justify-end">
            <Button type="submit" loading={passwordMutation.isPending}>Change Password</Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
