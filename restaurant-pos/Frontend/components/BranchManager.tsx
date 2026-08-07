/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BranchManager — Multi-branch CRUD and per-branch settings.
 * Only visible when enableMultiBranch is ON and user is Owner role.
 */

import React, { useState } from 'react';
import {
  Plus, Trash2, Building2, Check, X, Save, Info, ChevronDown, ChevronUp,
  Globe, MapPin, Phone, Settings, Users, Crown, LayoutGrid, Edit3, Download
} from 'lucide-react';
import type { Branch, Employee, SystemSettings, TableInfo, Bill, Order, ExpenseEntry } from '../src/types';
import * as api from '../src/api/client';
import { debugWarn } from '../src/utils/debugLog';
import BranchExport from './BranchExport';

interface BranchManagerProps {
  branches: Branch[];
  employees: Employee[];
  currentBranchId: string | null;
  branchSettings: Record<string, Partial<SystemSettings>>;
  onSetBranches: (branches: Branch[]) => void;
  onSetCurrentBranch: (id: string | null) => void;
  onSetBranchSettings: (settings: Record<string, Partial<SystemSettings>>) => void;
  branchTables?: Record<string, TableInfo[]>;
  onSetBranchTables?: (tables: Record<string, TableInfo[]>) => void;
  currencySymbol?: string;
  allBills?: Bill[];
  allOrders?: Order[];
  allExpenses?: ExpenseEntry[];
  subscriptionLimits?: {
    maxBranches: number;
    remainingBranches?: number | string;
  };
}

export default function BranchManager({
  branches, employees, currentBranchId,
  branchSettings, onSetBranches, onSetCurrentBranch, onSetBranchSettings,
  branchTables = {}, onSetBranchTables,
  currencySymbol = '₹', allBills = [], allOrders = [], allExpenses = [],
  subscriptionLimits
}: BranchManagerProps) {
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [newBranch, setNewBranch] = useState<Partial<Branch>>({
    name: '', address: '', phone: '', isHeadBranch: false, isActive: true,
  });
const [expandedBranch, setExpandedBranch] = useState<string | null>(null);
const [editingSettingsBranch, setEditingSettingsBranch] = useState<string | null>(null);
const [localToast, setLocalToast] = useState<string | null>(null);

// Per-branch settings form state
const [branchSettingsForm, setBranchSettingsForm] = useState<Partial<SystemSettings>>({});

const settingsFields: { key: keyof SystemSettings; label: string; type: 'text' | 'number'; placeholder: string }[] = [
  { key: 'restaurantName', label: 'Restaurant Name', type: 'text', placeholder: 'Branch name for receipts' },
  { key: 'gstin', label: 'GSTIN', type: 'text', placeholder: 'GSTIN number' },
  { key: 'address', label: 'Address', type: 'text', placeholder: 'Branch address' },
  { key: 'phone', label: 'Phone', type: 'text', placeholder: 'Phone number' },
  { key: 'defaultTaxRate', label: 'Default Tax Rate (%)', type: 'number', placeholder: 'e.g. 5' },
  { key: 'invoicePrefix', label: 'Invoice Prefix', type: 'text', placeholder: 'e.g. INV-' },
  { key: 'receiptFooterMessage', label: 'Receipt Footer', type: 'text', placeholder: 'Thank you message' },
];

// ============ EXPORT MODAL ============
const [isExportOpen, setIsExportOpen] = useState(false);
const isCurrentUserOnHeadBranch = (() => {
  const head = branches.find(b => b.isHeadBranch);
  return head && currentBranchId === head.id;
})();

// ============ TABLE LAYOUT EDITOR ============
const [editingTablesBranch, setEditingTablesBranch] = useState<string | null>(null);
const [tableEditorTables, setTableEditorTables] = useState<TableInfo[]>([]);
const [tableEditorForm, setTableEditorForm] = useState({ number: '', capacity: 4, section: 'Main Hall', status: 'Available' as const });
const [tableEditorNewSection, setTableEditorNewSection] = useState('');

const TABLE_SECTIONS_DEFAULT = ['Main Hall', 'Terrace', 'VIP Room', 'Garden'];

const handleOpenTableEditor = (branchId: string) => {
  const existing = branchTables[branchId];
  setTableEditorTables(existing ? [...existing] : []);
  setEditingTablesBranch(branchId);
};

const handleAddTableToEditor = () => {
  const num = Number(tableEditorForm.number);
  if (!num || num < 1) { showToast('Enter a valid table number'); return; }
  if (tableEditorTables.some(t => t.number === num)) { showToast(`Table #${num} already exists`); return; }
  const newTable: TableInfo = {
    id: `table_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    number: num,
    capacity: tableEditorForm.capacity,
    section: tableEditorForm.section,
    status: 'Available' as const,
  };
  setTableEditorTables([...tableEditorTables, newTable]);
  setTableEditorForm({ number: '', capacity: 4, section: tableEditorForm.section, status: 'Available' as const });
};

const handleRemoveTableFromEditor = (id: string) => {
  setTableEditorTables(tableEditorTables.filter(t => t.id !== id));
};

const handleSaveBranchTables = () => {
  if (!editingTablesBranch || !onSetBranchTables) return;
  onSetBranchTables({ ...branchTables, [editingTablesBranch]: tableEditorTables });
  setEditingTablesBranch(null);
  setTableEditorTables([]);
  showToast('Table layout saved for this branch');
};

const handleAddSection = () => {
  const val = tableEditorNewSection.trim();
  if (!val) return;
  const allSections = [...new Set([...TABLE_SECTIONS_DEFAULT, ...tableEditorTables.map(t => t.section).filter(Boolean)])];
  if (allSections.includes(val)) { showToast('Section already exists'); return; }
  setTableEditorForm(prev => ({ ...prev, section: val }));
  setTableEditorNewSection('');
};

const getBranchTableCount = (branchId: string) => {
  const t = branchTables[branchId];
  return t ? t.length : 0;
};

const handleOpenSettings = (branchId: string) => {
  const existing = branchSettings[branchId] || {};
  setBranchSettingsForm(existing);
  setEditingSettingsBranch(branchId);
};

const handleSaveBranchSettings = () => {
  if (!editingSettingsBranch) return;
  // Remove empty values so base settings still apply
  const cleaned = Object.fromEntries(
    Object.entries(branchSettingsForm).filter(([_, v]) => v !== '' && v !== undefined && v !== null)
  );
  onSetBranchSettings({
    ...branchSettings,
    [editingSettingsBranch]: cleaned,
  });
  setEditingSettingsBranch(null);
  setBranchSettingsForm({});
  showToast('Branch settings saved');
};

  const showToast = (msg: string) => {
    setLocalToast(msg);
    setTimeout(() => setLocalToast(null), 2500);
  };

  const handleAddBranch = () => {
    if (!newBranch.name?.trim()) {
      showToast('Branch name is required');
      return;
    }
    const branch: Branch = {
      id: `branch_${Date.now()}`,
      name: newBranch.name.trim(),
      address: newBranch.address || '',
      phone: newBranch.phone || '',
      isHeadBranch: newBranch.isHeadBranch || false,
      isActive: true,
      createdAt: new Date().toISOString(),
    };
    const next = [...branches, branch];
    onSetBranches(next);
    // BACKEND CALLED — create the location in /api/branches (Owner + multi-branch).
    // On success the local temp id is swapped for the server _id.
    api.createBranch({
      name: branch.name,
      address: branch.address || undefined,
      phone: branch.phone || undefined,
      isHeadBranch: branch.isHeadBranch,
      isActive: branch.isActive,
    }).then((created: any) => {
      const serverId = created?._id || created?.id;
      if (serverId) {
        onSetBranches(next.map((b) => b.id === branch.id ? { ...b, id: serverId } : b));
        // Re-key per-branch tables/settings and the current-branch pointer so a
        // temp→server id swap doesn't orphan them in multi-branch mode.
        if (onSetBranchTables && branchTables[branch.id]) {
          onSetBranchTables(Object.fromEntries(
            Object.entries(branchTables).map(([k, v]) => [k === branch.id ? serverId : k, v])
          ));
        }
        if (branchSettings[branch.id]) {
          onSetBranchSettings(Object.fromEntries(
            Object.entries(branchSettings).map(([k, v]) => [k === branch.id ? serverId : k, v])
          ));
        }
        if (currentBranchId === branch.id) onSetCurrentBranch(serverId);
      }
    }).catch(err => debugWarn('BranchManager', 'createBranch failed:', err));
    setNewBranch({ name: '', address: '', phone: '', isHeadBranch: false, isActive: true });
    setIsAdding(false);
    showToast(`Branch "${branch.name}" created`);
  };

  const handleUpdateBranch = (id: string, updates: Partial<Branch>) => {
    onSetBranches(branches.map(b => b.id === id ? { ...b, ...updates } : b));
    if (updates.isHeadBranch === true) {
      // Only one head branch allowed
      onSetBranches(branches.map(b => ({
        ...b,
        isHeadBranch: b.id === id ? true : false,
      })));
    }
    // BACKEND CALLED — push branch edits to /api/branches (Owner + multi-branch).
    if (/^[a-fA-F0-9]{24}$/.test(id)) {
      const payload: any = {};
      if (updates.name != null) payload.name = updates.name;
      if (updates.address != null) payload.address = updates.address || undefined;
      if (updates.phone != null) payload.phone = updates.phone || undefined;
      if (updates.isHeadBranch != null) payload.isHeadBranch = updates.isHeadBranch;
      if (updates.isActive != null) payload.isActive = updates.isActive;
      api.updateBranch(id, payload).catch(err => debugWarn('BranchManager', 'updateBranch failed:', err));
    }
    showToast('Branch updated');
  };

  const handleDeleteBranch = (id: string) => {
    const branch = branches.find(b => b.id === id);
    if (!branch) return;
    if (branches.length <= 1) {
      showToast('Cannot delete the only branch');
      return;
    }
    if (branch.isHeadBranch) {
      showToast('Cannot delete the head branch. Set another branch as head first.');
      return;
    }
    onSetBranches(branches.filter(b => b.id !== id));
    // BACKEND CALLED — remove the location from /api/branches (Owner only).
    if (/^[a-fA-F0-9]{24}$/.test(id)) {
      api.deleteBranch(id).catch(err => debugWarn('BranchManager', 'deleteBranch failed:', err));
    }
    if (currentBranchId === id) {
      const headBranch = branches.find(b => b.isHeadBranch);
      onSetCurrentBranch(headBranch?.id || branches[0]?.id || null);
    }
    showToast(`Branch "${branch.name}" deleted`);
  };

  const branchEmployees = (branchId: string) =>
    employees.filter(e => e.branchId === branchId && e.status === 'Active');

  const headBranch = branches.find(b => b.isHeadBranch);

  return (
    <div className="flex flex-col h-full bg-[#fbfbff]">
      {/* Toast */}
      {localToast && (
        <div className="fixed top-4 right-4 z-50 bg-[#191b23] text-white px-4 py-2 rounded-xl shadow-lg text-xs font-bold">
          {localToast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-[#e1e2ed]">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-50 text-[#004ac6]">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-md font-black tracking-tight text-gray-900">Branch Management</h1>
            <p className="text-[10px] text-gray-400">
              Manage restaurant locations and assign employees to branches
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isCurrentUserOnHeadBranch && (
            <button
              type="button"
              onClick={() => setIsExportOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white rounded-xl text-xs font-bold hover:bg-purple-700 transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Export Data
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (subscriptionLimits && typeof subscriptionLimits.remainingBranches === 'number' && subscriptionLimits.remainingBranches <= 0) {
                showToast('Branch limit reached. Upgrade your plan to add more branches.');
                return;
              }
              setIsAdding(true);
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
              subscriptionLimits && typeof subscriptionLimits.remainingBranches === 'number' && subscriptionLimits.remainingBranches <= 0
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-[#004ac6] text-white hover:bg-[#003ea8]'
            }`}
            title={subscriptionLimits && typeof subscriptionLimits.remainingBranches === 'number' && subscriptionLimits.remainingBranches <= 0 ? 'Branch limit reached' : 'Add new branch'}
          >
            <Plus className="w-3.5 h-3.5" />
            Add Branch
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-[#e1e2ed] p-4 shadow-xs">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Total Branches</p>
            <p className="text-xl font-black text-gray-900 mt-1">{branches.length}</p>
          </div>
          <div className="bg-white rounded-xl border border-[#e1e2ed] p-4 shadow-xs">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Active Branches</p>
            <p className="text-xl font-black text-green-600 mt-1">{branches.filter(b => b.isActive).length}</p>
          </div>
          <div className="bg-white rounded-xl border border-[#e1e2ed] p-4 shadow-xs">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Head Branch</p>
            <p className="text-base font-black text-purple-600 mt-1 truncate">{headBranch?.name || 'Not set'}</p>
          </div>
          {subscriptionLimits && (
            <div className={`bg-white rounded-xl border p-4 shadow-xs ${
              typeof subscriptionLimits.remainingBranches === 'number' && subscriptionLimits.remainingBranches <= 0
                ? 'border-red-200 bg-red-50'
                : 'border-[#e1e2ed]'
            }`}>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                Plan Limit{subscriptionLimits.remainingBranches === 0 ? '' : ' (remaining)'}
              </p>
              <p className={`text-xl font-black mt-1 ${
                typeof subscriptionLimits.remainingBranches === 'number' && subscriptionLimits.remainingBranches <= 0
                  ? 'text-red-600'
                  : 'text-gray-900'
              }`}>
                {subscriptionLimits.maxBranches === 0 ? 'Unlimited' : `${branches.length} / ${subscriptionLimits.maxBranches}`}
              </p>
              {subscriptionLimits.maxBranches > 0 && (
                <div className="w-full h-1.5 bg-gray-100 rounded-full mt-1.5 overflow-hidden">
                  <div 
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, (branches.length / subscriptionLimits.maxBranches) * 100)}%`,
                      backgroundColor: branches.length >= subscriptionLimits.maxBranches ? '#ef4444' : '#22c55e'
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Add branch form */}
        {isAdding && (
          <div className="bg-white rounded-xl border border-[#004ac6] p-5 mb-4 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Plus className="w-4 h-4 text-[#004ac6]" />
              <h3 className="font-bold text-[#191b23] text-xs uppercase tracking-wider">New Branch</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Branch Name *</label>
                <input
                  type="text"
                  value={newBranch.name || ''}
                  onChange={(e) => setNewBranch(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#004ac6]"
                  placeholder="e.g. Downtown Branch"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Phone</label>
                <input
                  type="text"
                  value={newBranch.phone || ''}
                  onChange={(e) => setNewBranch(prev => ({ ...prev, phone: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#004ac6]"
                  placeholder="+91 22 2200 4400"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Address</label>
                <input
                  type="text"
                  value={newBranch.address || ''}
                  onChange={(e) => setNewBranch(prev => ({ ...prev, address: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#004ac6]"
                  placeholder="Branch address"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleAddBranch}
                className="px-4 py-2 bg-[#004ac6] text-white rounded-xl text-xs font-bold hover:bg-[#003ea8] transition-colors cursor-pointer flex items-center gap-1"
              >
                <Check className="w-3.5 h-3.5" />
                Create Branch
              </button>
              <button
                type="button"
                onClick={() => { setIsAdding(false); setNewBranch({ name: '', address: '', phone: '', isHeadBranch: false, isActive: true }); }}
                className="px-4 py-2 border border-[#c3c6d7] rounded-xl text-xs font-bold text-gray-500 hover:bg-gray-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Branch list */}
        <div className="space-y-3">
          {branches.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Building2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-bold">No branches configured</p>
              <p className="text-xs mt-1">Add your first branch to get started</p>
            </div>
          ) : (
            branches.map(branch => {
              const isExpanded = expandedBranch === branch.id;
              const isCurrent = currentBranchId === branch.id;
              const employeesHere = branchEmployees(branch.id);
              return (
                <div
                  key={branch.id}
                  className={`bg-white rounded-xl border p-4 transition-all ${
                    isCurrent ? 'border-[#004ac6] shadow-sm' : 'border-[#e1e2ed]'
                  }`}
                >
                  {/* Branch header row */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className={`p-2 rounded-lg ${branch.isHeadBranch ? 'bg-purple-100' : 'bg-blue-50'}`}>
                        {branch.isHeadBranch ? (
                          <Crown className="w-4 h-4 text-purple-600" />
                        ) : (
                          <Building2 className="w-4 h-4 text-[#004ac6]" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-gray-900 truncate">{branch.name}</span>
                          {branch.isHeadBranch && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 uppercase tracking-wider">
                              Head
                            </span>
                          )}
                          {!branch.isActive && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 uppercase tracking-wider">
                              Inactive
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          {employeesHere.length} employee{employeesHere.length !== 1 ? 's' : ''} · {branch.address || 'No address'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => onSetCurrentBranch(branch.id === currentBranchId ? null : branch.id)}
                        className={`px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                          isCurrent
                            ? 'bg-[#004ac6] text-white'
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                      >
                        {isCurrent ? 'Active' : 'Switch'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setExpandedBranch(isExpanded ? null : branch.id)}
                        className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
                      >
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteBranch(branch.id)}
                        className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                        title="Delete branch"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Expanded: edit branch details */}
                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-[#e1e2ed] space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Branch Name</label>
                          <input
                            type="text"
                            value={branch.name}
                            onChange={(e) => handleUpdateBranch(branch.id, { name: e.target.value })}
                            className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#004ac6]"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Phone</label>
                          <input
                            type="text"
                            value={branch.phone || ''}
                            onChange={(e) => handleUpdateBranch(branch.id, { phone: e.target.value })}
                            className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#004ac6]"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Address</label>
                          <input
                            type="text"
                            value={branch.address || ''}
                            onChange={(e) => handleUpdateBranch(branch.id, { address: e.target.value })}
                            className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#004ac6]"
                          />
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={branch.isHeadBranch}
                            onChange={() => handleUpdateBranch(branch.id, { isHeadBranch: !branch.isHeadBranch })}
                            className="w-4 h-4 rounded border-gray-300 text-[#004ac6] focus:ring-[#004ac6]"
                          />
                          <span className="text-xs font-bold text-gray-700">Set as Head Branch</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={branch.isActive}
                            onChange={() => handleUpdateBranch(branch.id, { isActive: !branch.isActive })}
                            className="w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-600"
                          />
                          <span className="text-xs font-bold text-gray-700">Active</span>
                        </label>
                      </div>

                      {/* Branch Settings + Table Layout buttons */}
                      <div className="flex items-center gap-2 pt-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() => handleOpenSettings(branch.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-[#004ac6] hover:bg-blue-100 rounded-lg text-[10px] font-bold transition-colors cursor-pointer"
                        >
                          <Settings className="w-3.5 h-3.5" />
                          Branch Settings
                        </button>
                        {branchSettings[branch.id] && Object.keys(branchSettings[branch.id]).length > 0 && (
                          <span className="text-[9px] text-green-600 font-medium">
                            ✓ {Object.keys(branchSettings[branch.id]).length} override{Object.keys(branchSettings[branch.id]).length > 1 ? 's' : ''} set
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => handleOpenTableEditor(branch.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded-lg text-[10px] font-bold transition-colors cursor-pointer"
                        >
                          <LayoutGrid className="w-3.5 h-3.5" />
                          Table Layout
                        </button>
                        {getBranchTableCount(branch.id) > 0 && (
                          <span className="text-[9px] text-amber-600 font-medium">
                            {getBranchTableCount(branch.id)} table{getBranchTableCount(branch.id) > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>

                      {/* Employees assigned to this branch */}
                      {employeesHere.length > 0 && (
                        <div className="bg-gray-50 rounded-xl p-3">
                          <div className="flex items-center gap-1.5 mb-2">
                            <Users className="w-3.5 h-3.5 text-gray-500" />
                            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                              Assigned Employees ({employeesHere.length})
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {employeesHere.map(emp => (
                              <span key={emp.id} className="text-[9px] px-2 py-0.5 rounded-full bg-white border border-gray-200 text-gray-600 font-medium">
                                {emp.name} ({emp.role})
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Branch Settings Editor Modal */}
        {editingSettingsBranch && (() => {
          const branch = branches.find(b => b.id === editingSettingsBranch);
          if (!branch) return null;
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setEditingSettingsBranch(null)}>
              <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full mx-4 border border-[#e1e2ed] max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <div className="p-5 border-b border-[#e1e2ed] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Settings className="w-4 h-4 text-[#004ac6]" />
                    <h3 className="font-bold text-sm text-[#191b23]">Settings Override: {branch.name}</h3>
                  </div>
                  <button onClick={() => setEditingSettingsBranch(null)} className="text-gray-400 hover:text-gray-600 p-1 cursor-pointer">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="p-5 space-y-4">
                  <p className="text-[10px] text-gray-400 mb-2">
                    Override base settings for this branch. Leave fields empty to use the default (base) settings.
                  </p>
                  {settingsFields.map(({ key, label, type, placeholder }) => (
                    <div key={key}>
                      <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">{label}</label>
                      <input
                        type={type}
                        value={(branchSettingsForm[key] as string | number) ?? ''}
                        onChange={(e) => setBranchSettingsForm(prev => ({
                          ...prev,
                          [key]: type === 'number' ? (e.target.value ? Number(e.target.value) : '') : e.target.value,
                        }))}
                        className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#004ac6]"
                        placeholder={placeholder}
                      />
                    </div>
                  ))}

                  {/* Current overrides summary */}
                  {branchSettings[editingSettingsBranch] && Object.keys(branchSettings[editingSettingsBranch]).length > 0 && (
                    <div className="bg-blue-50 rounded-xl p-3 text-[10px] text-blue-800">
                      <span className="font-bold">Currently overriding: </span>
                      {Object.keys(branchSettings[editingSettingsBranch]).join(', ')}
                    </div>
                  )}

                  <div className="flex gap-2 pt-2 border-t border-gray-100">
                    <button
                      type="button"
                      onClick={() => {
                        // Clear all settings for this branch
                        const updated = { ...branchSettings };
                        delete updated[editingSettingsBranch];
                        onSetBranchSettings(updated);
                        setEditingSettingsBranch(null);
                        showToast('Branch settings cleared (using defaults)');
                      }}
                      className="px-3 py-2 border border-red-200 text-red-600 rounded-xl text-xs font-bold hover:bg-red-50 transition-colors cursor-pointer"
                    >
                      Reset to Defaults
                    </button>
                    <div className="flex-1" />
                    <button
                      type="button"
                      onClick={() => setEditingSettingsBranch(null)}
                      className="px-4 py-2 border border-[#c3c6d7] rounded-xl text-xs font-bold text-gray-500 hover:bg-gray-50 transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveBranchSettings}
                      className="px-4 py-2 bg-[#004ac6] text-white rounded-xl text-xs font-bold hover:bg-[#003ea8] transition-colors cursor-pointer flex items-center gap-1"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Save Settings
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Branch Export Modal */}
        {isExportOpen && (
          <BranchExport
            branches={branches}
            allBills={allBills}
            allOrders={allOrders}
            allEmployees={employees}
            allExpenses={allExpenses}
            currencySymbol={currencySymbol}
            onClose={() => setIsExportOpen(false)}
          />
        )}

        {/* Table Layout Editor Modal */}
        {editingTablesBranch && (() => {
          const branch = branches.find(b => b.id === editingTablesBranch);
          if (!branch) return null;
          const sections = [...new Set([...TABLE_SECTIONS_DEFAULT, ...tableEditorTables.map(t => t.section).filter(Boolean)])];
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setEditingTablesBranch(null)}>
              <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full mx-4 border border-[#e1e2ed] max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <div className="p-5 border-b border-[#e1e2ed] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <LayoutGrid className="w-4 h-4 text-amber-600" />
                    <h3 className="font-bold text-sm text-[#191b23]">Table Layout: {branch.name}</h3>
                  </div>
                  <button onClick={() => setEditingTablesBranch(null)} className="text-gray-400 hover:text-gray-600 p-1 cursor-pointer">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="p-5 space-y-4">
                  <p className="text-[10px] text-gray-400 mb-2">
                    Define the floor plan for this branch. Tables will appear in the Order Management &amp; Floor Plan views.
                    Leave empty to use the global default table layout (24 tables).
                  </p>

                  {/* Add table form */}
                  <div className="bg-amber-50/50 rounded-xl p-4 border border-amber-100">
                    <div className="grid grid-cols-4 gap-3">
                      <div>
                        <label className="block text-[9px] font-bold uppercase text-gray-500 mb-1">Table #</label>
                        <input
                          type="number" min="1"
                          value={tableEditorForm.number}
                          onChange={(e) => setTableEditorForm(prev => ({ ...prev, number: e.target.value }))}
                          className="w-full px-2 py-1.5 rounded-lg border border-[#c3c6d7] text-xs font-bold focus:outline-none focus:ring-1 focus:ring-amber-500"
                          placeholder="e.g. 1"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-bold uppercase text-gray-500 mb-1">Capacity</label>
                        <input
                          type="number" min="1" max="20"
                          value={tableEditorForm.capacity}
                          onChange={(e) => setTableEditorForm(prev => ({ ...prev, capacity: Number(e.target.value) }))}
                          className="w-full px-2 py-1.5 rounded-lg border border-[#c3c6d7] text-xs font-bold focus:outline-none focus:ring-1 focus:ring-amber-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-bold uppercase text-gray-500 mb-1">Section</label>
                        <div className="flex gap-1">
                          <select
                            value={tableEditorForm.section}
                            onChange={(e) => setTableEditorForm(prev => ({ ...prev, section: e.target.value }))}
                            className="flex-1 px-2 py-1.5 rounded-lg border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-amber-500"
                          >
                            {sections.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="flex items-end gap-1">
                        <input
                          type="text" value={tableEditorNewSection}
                          onChange={(e) => setTableEditorNewSection(e.target.value)}
                          placeholder="New section"
                          className="flex-1 px-2 py-1.5 rounded-lg border border-[#c3c6d7] text-[10px] focus:outline-none focus:ring-1 focus:ring-amber-500"
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddSection(); } }}
                        />
                        <button
                          type="button"
                          onClick={handleAddSection}
                          className="p-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors cursor-pointer"
                          title="Add section"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={handleAddTableToEditor}
                          className="px-3 py-1.5 bg-amber-600 text-white rounded-lg text-[10px] font-bold hover:bg-amber-700 transition-colors cursor-pointer whitespace-nowrap"
                        >
                          + Add Table
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Table list */}
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {tableEditorTables.length === 0 ? (
                      <div className="text-center py-6 text-gray-400">
                        <LayoutGrid className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        <p className="text-xs font-bold">No tables defined</p>
                        <p className="text-[10px] mt-1">Will use the global default layout (24 tables)</p>
                      </div>
                    ) : (
                      tableEditorTables.map((tbl, idx) => (
                        <div key={tbl.id} className="flex items-center gap-3 bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                          <span className="w-6 h-6 rounded-full bg-amber-100 text-amber-800 text-[10px] font-black flex items-center justify-center shrink-0">
                            {tbl.number}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-gray-800">Table #{tbl.number}</span>
                              <span className="text-[9px] text-gray-400">Cap: {tbl.capacity}</span>
                              <span className="px-1.5 py-0.2 rounded text-[8px] font-bold bg-gray-200 text-gray-600">
                                {tbl.section || 'No section'}
                              </span>
                            </div>
                          </div>
                          <button
                            onClick={() => handleRemoveTableFromEditor(tbl.id)}
                            className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Section breakdown */}
                  {tableEditorTables.length > 0 && (() => {
                    const bySection: Record<string, number> = {};
                    tableEditorTables.forEach(t => {
                      const s = t.section || 'Unassigned';
                      bySection[s] = (bySection[s] || 0) + 1;
                    });
                    return (
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(bySection).map(([section, count]) => (
                          <span key={section} className="px-2 py-0.5 rounded-full bg-gray-100 text-[9px] font-medium text-gray-600">
                            {section}: {count} table{count > 1 ? 's' : ''}
                          </span>
                        ))}
                      </div>
                    );
                  })()}

                  <div className="flex gap-2 pt-3 border-t border-gray-100">
                    <button
                      type="button"
                      onClick={() => {
                        // Reset to empty (use global defaults)
                        if (onSetBranchTables) {
                          const updated = { ...branchTables };
                          delete updated[editingTablesBranch];
                          onSetBranchTables(updated);
                        }
                        setEditingTablesBranch(null);
                        showToast('Table layout reset to global defaults');
                      }}
                      className="px-3 py-2 border border-red-200 text-red-600 rounded-xl text-xs font-bold hover:bg-red-50 transition-colors cursor-pointer"
                    >
                      Reset to Defaults
                    </button>
                    <div className="flex-1" />
                    <button
                      type="button"
                      onClick={() => setEditingTablesBranch(null)}
                      className="px-4 py-2 border border-[#c3c6d7] rounded-xl text-xs font-bold text-gray-500 hover:bg-gray-50 transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveBranchTables}
                      className="px-4 py-2 bg-amber-600 text-white rounded-xl text-xs font-bold hover:bg-amber-700 transition-colors cursor-pointer flex items-center gap-1"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Save Layout
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Info box */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mt-6 flex items-start gap-2.5">
          <Info className="w-4 h-4 text-[#004ac6] shrink-0 mt-0.5" />
          <div className="text-[11px] text-blue-800">
            <p className="font-bold mb-1">How Multi-Branch Works</p>
            <ul className="space-y-1 list-disc list-inside text-[10px] opacity-80">
              <li>The <strong>Head Branch</strong> can view all data across branches for consolidated reporting</li>
              <li><strong>Regular branches</strong> only see their own orders, bills, tables, and employees</li>
              <li>Assign employees to branches in <strong>Staff Management</strong> to control branch access</li>
              <li>Each branch has its <strong>own floor plan</strong> — configure tables &amp; sections in the &quot;Table Layout&quot; editor</li>
              <li>Products can be shared or have branch-specific pricing; tables &amp; employees are branch-specific</li>
              <li>Switch between branches using the dropdown in the top bar</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
