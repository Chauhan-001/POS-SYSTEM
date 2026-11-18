/**
 * =============================================================================
 *  ShiftManager.tsx — Cash Drawer Shift Management (Phase 6)
 *  =============================================================================
 *
 *  Shift lifecycle UI for the POS terminal. Cashiers can open a shift with an
 *  opening float, view active shift details, and close the shift with a counted
 *  cash amount. Managers can close any shift.
 *
 *  All data computed server-side via /api/cash-ledger/* endpoints — frontend
 *  only renders.
 */

import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Wallet, Plus, ReceiptText, Clock, AlertTriangle, ChevronRight,
  Banknote, Activity, TrendingUp,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Skeleton } from '../../components/ui/Skeleton';
import { ErrorPage } from '../../components/ui/ErrorPage';
import { openShift, closeShift, fetchCashLedger, getCashBalance } from '../../api/client';
import { formatNumber } from '../../utils/format';

const CURRENCY = '₹';
const fmt = (n: number) => `${CURRENCY}${formatNumber(Math.round(n))}`;

export default function ShiftManager() {
  const navigate = useNavigate();
  const [shiftState, setShiftState] = useState<'closed' | 'open'>('closed');
  const [shiftData, setShiftData] = useState<any>(null);
  const [openingAmount, setOpeningAmount] = useState('');
  const [closingCash, setClosingCash] = useState('');
  const [isOpening, setIsOpening] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpenShift = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsOpening(true);
    setError(null);
    try {
      const result = await openShift(Number(openingAmount || 0));
      if (result.ok) {
        setShiftState('open');
        setShiftData(result.data);
        setOpeningAmount('');
      } else {
        setError(result.error || 'Failed to open shift');
      }
    } catch (err) {
      setError('Failed to open shift');
    } finally {
      setIsOpening(false);
    }
  };

  const handleCloseShift = async () => {
    setIsClosing(true);
    setError(null);
    try {
      const result = await closeShift(Number(closingCash || 0));
      if (result.ok) {
        setShiftState('closed');
        setShiftData(null);
        setClosingCash('');
      } else {
        setError(result.error || 'Failed to close shift');
      }
    } catch (err) {
      setError('Failed to close shift');
    } finally {
      setIsClosing(false);
    }
  };

  if (shiftState === 'closed') {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-surface-900 dark:text-surface-100">Cash Drawer</h2>
            <p className="text-sm text-surface-500">No active shift. Open a drawer to begin taking cash payments.</p>
          </div>
        </div>

        {/* Open Shift Card */}
        <Card className="rounded-xl p-6">
          <CardHeader>
            <div className="flex items-center gap-3">
              <Wallet size={20} className="text-emerald-600" />
              <CardTitle>Open Shift</CardTitle>
              <CardDescription>Enter opening cash to start your shift</CardDescription>
            </div>
          </CardHeader>
          <div className="p-6">
            <form onSubmit={handleOpenShift} className="space-y-4">
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col">
                    <label className="text-xs font-semibold text-surface-500">Opening Cash</label>
                    <input
                      type="number"
                      value={openingAmount}
                      onChange={(e) => setOpeningAmount(e.target.value)}
                      placeholder="0.00"
                      className="h-10 px-3 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                  <div className="flex items-end">
                    <Button type="submit" className="w-full">
                      Open Shift
                    </Button>
                  </div>
                </div>
                {error && (
                  <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
                    {error}
                  </div>
                )}
              </div>
            </form>
          </div>
        </Card>

        {/* Info */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader><CardTitle>Shift Status</CardTitle></CardHeader>
            <div className="p-6 text-center">
              <p className="text-lg font-bold text-red-600">CLOSED</p>
              <p className="text-sm text-surface-500">No active shift</p>
            </div>
          </Card>
          <Card>
            <CardHeader><CardTitle>Opening Cash</CardTitle></CardHeader>
            <div className="p-6 text-center">
              <p className="text-lg font-bold text-surface-900 dark:text-surface-100">—</p>
              <p className="text-sm text-surface-500">Enter opening cash to start</p>
            </div>
          </Card>
          <Card>
            <CardHeader><CardTitle>Expected Cash</CardTitle></CardHeader>
            <div className="p-6 text-center">
              <p className="text-lg font-bold text-surface-900 dark:text-surface-100">—</p>
              <p className="text-sm text-surface-500">Calculated after closing</p>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  // Active shift view
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-surface-900 dark:text-surface-100">Shift Open</h2>
          <p className="text-sm text-surface-500">Cash drawer is active</p>
        </div>
        <Badge variant="success" className="text-xs">
          Active Shift
        </Badge>
      </div>

      {/* Shift Info Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Opening Cash</CardTitle>
          </CardHeader>
          <div className="p-6">
            <p className="text-2xl font-bold text-emerald-600">{fmt(shiftData?.openingCash || 0)}</td>
          </div>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Expected Cash</CardTitle>
          </CardHeader>
          <div className="p-6">
            <p className="text-2xl font-bold text-blue-600">{fmt(shiftData?.expectedCash || 0)}</td>
          </div>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Variance</CardTitle>
          </CardHeader>
          <div className="p-6">
            <p className="text-2xl font-bold text-red-600">—</td>
          </div>
        </Card>
      </div>

      {/* Cash In / Out */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Cash In</CardTitle>
          </CardHeader>
          <div className="p-6">
            <div className="flex items-center justify-between">
              <span className="text-sm text-surface-500">Add cash to drawer</span>
              <Button variant="ghost" size="sm">Add</Button>
            </div>
            <div className="mt-4">
              <input
                type="number"
                value={closingCash}
                onChange={(e) => setClosingCash(e.target.value)}
                placeholder="0.00"
                className="h-10 px-3 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <p className="text-xs text-surface-500 mt-2">Enter cash to add</p>
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Cash Out</CardTitle>
          </CardHeader>
          <div className="p-6">
            <div className="flex items-center justify-between">
              <span className="text-sm text-surface-500">Remove cash from drawer</span>
              <Button variant="ghost" size="sm">Remove</Button>
            </div>
            <div className="mt-4">
              <p className="text-sm text-surface-500">Not available until shift has cash sales</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Close Shift */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Close Shift</CardTitle>
              <CardDescription>Enter actual cash counted to close</CardDescription>
            </div>
          </div>
          <div className="p-6">
            <form onSubmit={(e) => {
              e.preventDefault();
              handleCloseShift();
            }}>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-surface-500">Actual Cash Counted</label>
                  <span className="text-lg font-mono text-surface-900 dark:text-surface-100">{fmt(Number(closingCash || 0))}</span>
                </div>
                <input
                  type="number"
                  value={closingCash}
                  onChange={(e) => setClosingCash(e.target.value)}
                  placeholder="0.00"
                  className="h-10 px-3 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <p className="text-xs text-surface-500 mt-2">Enter the actual cash counted in the drawer</p>
                {error && (
                  <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
                    {error}
                  </div>
                )}
                <Button type="submit" className="w-full" disabled={isClosing}>
                  {isClosing ? 'Closing...' : 'Close Shift'}
                </Button>
              </div>
            </form>
          </div>
        </Card>
      </div>

      {/* Current Shift Info */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader><CardTitle>Shift Started</CardTitle></CardHeader>
          <div className="p-6">
            <p className="text-lg font-bold text-surface-900 dark:text-surface-100">{shiftData?.openedAt ? new Date(shiftData.openedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '—'}</td>
            <p className="text-sm text-surface-500">Shift opened</p>
          </div>
        </Card>
        <Card>
          <CardHeader><CardTitle>Cashier</CardTitle></CardHeader>
          <div className="p-6">
            <p className="text-lg font-bold text-surface-900 dark:text-surface-100">Cashier</td>
            <p className="text-sm text-surface-500">Shift operator</p>
          </div>
        </Card>
        <Card>
          <CardHeader><CardTitle>Register</CardTitle></CardHeader>
          <div className="p-6">
            <p className="text-lg font-bold text-surface-900 dark:text-surface-100">Register 1</td>
            <p className="text-sm text-surface-500">Cash drawer terminal</p>
          </div>
        </Card>
        <Card>
          <CardHeader><CardTitle>Status</CardTitle></CardHeader>
          <div className="p-6">
            <Badge variant="success" className="text-lg">
              Active
            </Badge>
          </div>
        </Card>
      </div>
    </div>
  );
}