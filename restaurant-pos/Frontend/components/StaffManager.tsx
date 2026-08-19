/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { Users, Plus, Shield, Check, X, ShieldAlert, User, Clock, Trash2, KeyRound, Building2 } from 'lucide-react';
import { Employee, LoginSession, Branch } from '../src/types';
import * as api from '../src/api/client';
import { debugWarn } from '../src/utils/debugLog';

interface StaffManagerProps {
  employees: Employee[];
  onUpdateEmployees: (updated: Employee[]) => void;
  currentEmployee: Employee;
  branches?: Branch[];
}

/** Format a login timestamp as "YYYY-MM-DD HH:mm:ss". Unset/legacy values pass through. */
function formatLoginTime(value?: string): string {
  if (!value) return 'Never';
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export default function StaffManager({ employees, onUpdateEmployees, currentEmployee, branches = [] }: StaffManagerProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingEmp, setEditingEmp] = useState<Employee | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [uname, setUname] = useState('');
  const [role, setRole] = useState<'Owner' | 'Manager' | 'Cashier'>('Cashier');
  const [pin, setPin] = useState('');
  const [password, setPassword] = useState('');
  const [generatedCreds, setGeneratedCreds] = useState<{ userId: string; password: string } | null>(null);
  const [status, setStatus] = useState<'Active' | 'Inactive'>('Active');
  const [branchId, setBranchId] = useState(branches.length > 0 ? branches[0].id : '');
  
  const [error, setError] = useState('');

  // Deletion confirmation helper state
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Real login audit — derived from the actual staff records (last login per
  // employee). No fabricated sessions: staff who have never logged in on this
  // device simply show "Never", and only real employees appear here.
  const sessions = useMemo<LoginSession[]>(() =>
    employees
      .map((e) => ({
        id: e.id,
        username: e.username,
        name: e.name,
        role: e.role,
        loginTime: formatLoginTime(e.lastLogin),
        ipAddress: '',
      }))
      .sort((a, b) => {
        const ta = a.loginTime && a.loginTime !== 'Never' ? new Date(a.loginTime).getTime() : 0;
        const tb = b.loginTime && b.loginTime !== 'Never' ? new Date(b.loginTime).getTime() : 0;
        return tb - ta;
      }),
    [employees],
  );

  const handleSaveEmployee = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim() || !uname.trim() || !pin.trim()) {
      setError('Please fill in all mandatory parameters.');
      return;
    }

    if (pin.trim().length !== 4 || isNaN(Number(pin.trim()))) {
      setError('Staff login PIN must be exactly 4 numeric digits.');
      return;
    }

    // Check unique username
    if (!editingEmp && employees.some(emp => emp.username.toLowerCase() === uname.trim().toLowerCase())) {
      setError('This employee ID / Username is already registered.');
      return;
    }

    if (editingEmp) {
      // Edit mode
      const updated = employees.map(emp => {
        if (emp.id === editingEmp.id) {
          // Check if self-deactivating
          if (emp.id === currentEmployee.id && status === 'Inactive') {
            setError('Self deactivation is prevented for active POS session.');
            return emp;
          }
          return {
            ...emp,
            name: name.trim(),
            username: uname.trim().toLowerCase(),
            role: role,
            pin: pin.trim(),
            status: status,
            branchId: branchId || emp.branchId,
          };
        }
        return emp;
      });
      if (error) return;
      onUpdateEmployees(updated);
      // BACKEND CALLED — push role/PIN/status changes to /api/employees.
      // Only employees that already exist server-side (Mongo id) can sync;
      // seeded/demo staff with local-only ids are skipped.
      const empId = editingEmp.id;
      if (/^[a-fA-F0-9]{24}$/.test(empId)) {
        api.updateEmployee(empId, {
          name: name.trim(),
          username: uname.trim().toLowerCase(),
          role,
          pin: pin.trim(),
          status,
          ...(branchId && /^[a-fA-F0-9]{24}$/.test(branchId) ? { branchId } : {}),
        }).catch(err => debugWarn('StaffManager', 'updateEmployee failed:', err));
      }
    } else {
      // Create mode
      const newEmp: Employee = {
        id: `emp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        name: name.trim(),
        username: uname.trim().toLowerCase(),
        role: role,
        pin: pin.trim(),
        status: 'Active',
        branchId: branchId || undefined,
      };
      const next = [...employees, newEmp];
      onUpdateEmployees(next);
      // BACKEND CALLED — hire the staff member in /api/employees (Owner only).
      // On success the local temp id is swapped for the server _id so later
      // edits/deletes/merges line up. branchId is sent only when it's a Mongo
      // ObjectId (the schema rejects local ids like branch_main).
      api.createEmployee({
        username: newEmp.username,
        name: newEmp.name,
        role: newEmp.role,
        pin: newEmp.pin,
        status: newEmp.status,
        ...(password ? { password } : {}),
        ...(newEmp.branchId && /^[a-fA-F0-9]{24}$/.test(newEmp.branchId) ? { branchId: newEmp.branchId } : {}),
      }).then((created: any) => {
        const serverId = created?._id || created?.id;
        if (serverId) {
          onUpdateEmployees(next.map((e) => e.id === newEmp.id ? { ...e, id: serverId } : e));
        }
      }).catch(err => debugWarn('StaffManager', 'createEmployee failed:', err));
    }

    setIsAdding(false);
    setEditingEmp(null);
    setName('');
    setUname('');
    setPin('');
    setPassword('');
    setGeneratedCreds(null);
    setRole('Cashier');
    setStatus('Active');
    setBranchId(branches.length > 0 ? branches[0].id : '');
  };

  const openEditModal = (emp: Employee) => {
    setEditingEmp(emp);
    setName(emp.name);
    setUname(emp.username);
    setRole(emp.role);
    setPin(emp.pin);
    setStatus(emp.status);
    setBranchId(emp.branchId || (branches.length > 0 ? branches[0].id : ''));
    setIsAdding(true);
  };

  // Generate a unique User ID + password for the staff member (Owner only).
  // The plaintext is shown once so it can be handed to the staff member;
  // only the hash is stored server-side.
  const handleGenerateCredentials = async () => {
    setError('');
    setGeneratedCreds(null);
    try {
      const res = await api.generateCredentials({
        name: name.trim() || role,
        role,
        avoid: employees.map((e) => e.username),
      });
      if (res?.userId) {
        setUname(res.userId);
        setPassword(res.password);
        setGeneratedCreds({ userId: res.userId, password: res.password });
      } else {
        setError('Could not generate credentials. Check your connection.');
      }
    } catch (err) {
      debugWarn('StaffManager', 'generateCredentials failed:', err);
      setError('Could not generate credentials online. Try again when connected.');
    }
  };

  const handleDeleteEmployee = (empId: string) => {
    if (empId === currentEmployee.id) {
      alert('You cannot terminate your own active workspace account.');
      return;
    }
    if (deleteConfirmId === empId) {
      onUpdateEmployees(employees.filter(emp => emp.id !== empId));
      // BACKEND CALLED — terminate the staff member (Owner only).
      if (/^[a-fA-F0-9]{24}$/.test(empId)) {
        api.deleteEmployee(empId).catch(err => debugWarn('StaffManager', 'deleteEmployee failed:', err));
      }
      setDeleteConfirmId(null);
    } else {
      setDeleteConfirmId(empId);
      setTimeout(() => {
        setDeleteConfirmId(current => current === empId ? null : current);
      }, 4000);
    }
  };

  // Helper colors for employee roles
  const getRoleColor = (userRole: 'Owner' | 'Manager' | 'Cashier') => {
    switch (userRole) {
      case 'Owner': return 'bg-purple-100 text-purple-700 border border-purple-200';
      case 'Manager': return 'bg-blue-100 text-blue-700 border border-blue-200';
      case 'Cashier': return 'bg-green-100 text-green-700 border border-green-200';
    }
  };

  return (
    <div id="staff_workspace" className="p-6 h-full flex gap-6 font-sans">
      
      {/* Left Column: Staff Roster */}
      <div className="flex-1 flex flex-col bg-[var(--color-bg-white)] rounded-xl border border-[var(--color-border-default)] shadow-sm overflow-hidden h-full">
        <div className="p-4 border-b border-[var(--color-border-default)] bg-gray-50 flex justify-between items-center">
          <div className="flex flex-col gap-0.5">
            <h3 className="font-bold text-[var(--color-text-primary)] text-sm">Authorized Terminal Personnel</h3>
            <p className="text-[10px] text-gray-500">Manage shift operators, change quick-access PIN codes, and audit system credentials.</p>
          </div>

          {currentEmployee.role !== 'Cashier' && (
            <button
              onClick={() => { setIsAdding(true); setEditingEmp(null); }}
              className="flex items-center gap-1 bg-[var(--brand-color)] hover:bg-[var(--color-primary-hover)] text-white px-3 py-1.5 rounded-lg font-semibold text-xs transition-colors shadow-sm cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Authorize Staff
            </button>
          )}
        </div>

        {/* Staff Table */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {employees.map((emp) => (
              <div 
                key={emp.id} 
                className={`p-4 rounded-xl border bg-[var(--color-bg-white)] shadow-sm flex justify-between items-start transition-all ${
                  emp.status === 'Active' ? 'border-[var(--color-border-default)] hover:shadow-md' : 'border-gray-200 opacity-60 bg-gray-50/50'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-[var(--color-primary-light)] border border-[var(--color-border-input)] text-[var(--brand-color)] font-bold text-sm flex items-center justify-center uppercase shadow-inner shrink-0">
                    {emp.name.charAt(0)}
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <strong className="text-xs text-[var(--color-text-primary)] block leading-tight">{emp.name}</strong>
                      {emp.id === currentEmployee.id && (
                        <span className="text-[9px] font-bold bg-[var(--brand-color)] text-white px-1.5 py-0.2 rounded-full uppercase scale-90">
                          YOU
                        </span>
                      )}
                    </div>
                    
                    <span className="text-[9px] font-mono text-gray-400 block uppercase">ID: {emp.username}</span>

                    <div className="flex gap-2 items-center pt-1 flex-wrap">
                      <span className={`text-[9px] font-bold px-2 py-0.2 rounded uppercase ${getRoleColor(emp.role)}`}>
                        {emp.role}
                      </span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded uppercase font-mono ${emp.status === 'Active' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                        {emp.status}
                      </span>
                    </div>

                    <p className="flex items-center gap-1 text-[9px] text-gray-400 pt-0.5">
                      <Clock className="w-3 h-3 shrink-0" />
                      Last login: <span className="font-mono">{formatLoginTime(emp.lastLogin)}</span>
                    </p>
                  </div>
                </div>

                {/* PIN and edit panel */}
                {currentEmployee.role !== 'Cashier' && (
                  <div className="flex flex-col items-end gap-2.5">
                    <div className="text-right">
                      <span className="text-[9px] text-gray-400 font-bold block uppercase tracking-wider">PIN Code</span>
                      <strong className="text-xs font-mono font-bold tracking-widest text-[var(--brand-color)] bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100">
                        {emp.pin}
                      </strong>
                    </div>

                    <div className="flex gap-1.5 items-center">
                      <button
                        onClick={() => openEditModal(emp)}
                        className="p-1 text-gray-500 hover:text-[var(--brand-color)] bg-[var(--color-bg-page)] hover:bg-[var(--color-surface-muted)] rounded border border-[var(--color-border-default)] text-[10px] font-semibold cursor-pointer"
                      >
                        Modify
                      </button>
                      
                      {emp.id !== currentEmployee.id && (
                        <button
                          onClick={() => handleDeleteEmployee(emp.id)}
                          className={`p-1.5 rounded border text-[10px] font-bold cursor-pointer transition-all ${
                            deleteConfirmId === emp.id
                              ? 'bg-[var(--color-red-600-solid)] border-red-600 text-white animate-pulse'
                              : 'text-red-400 hover:text-red-600 bg-red-50/50 hover:bg-red-50 border-red-100'
                          }`}
                        >
                          {deleteConfirmId === emp.id ? 'Confirm?' : 'Revoke'}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right Column: Adding Form OR Login logs */}
      <div className="w-80 bg-[var(--color-bg-white)] rounded-xl border border-[var(--color-border-default)] shadow-sm overflow-hidden flex flex-col h-full shrink-0">
        {isAdding && currentEmployee.role !== 'Cashier' ? (
          /* Create or edit form */
          <form onSubmit={handleSaveEmployee} className="p-4 flex flex-col justify-between h-full overflow-y-auto">
            <div className="space-y-4">
              <div className="border-b border-gray-100 pb-2 mb-2">
                <h3 className="font-bold text-[var(--color-text-primary)] text-xs flex items-center gap-1">
                  <Shield className="w-4 h-4 text-[var(--brand-color)]" />
                  {editingEmp ? 'Modify Permissions' : 'Authorize Staff'}
                </h3>
              </div>

              {error && (
                <div className="p-2 bg-red-50 border border-red-200 text-red-700 text-[10px] rounded-md">
                  {error}
                </div>
              )}

              {/* Name */}
              <div>
                <label className="block text-[9px] font-bold uppercase text-gray-500 mb-1">Full Staff Name</label>
                <input
                  type="text"
                  placeholder="e.g., Ravi Singh"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--color-border-input)] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)]"
                  required
                />
              </div>

              {/* ID / Username */}
              <div>
                <label className="block text-[9px] font-bold uppercase text-gray-500 mb-1">Login Username</label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    placeholder="e.g., ravi_cashier"
                    value={uname}
                    onChange={(e) => setUname(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--color-border-input)] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)] font-mono lowercase"
                    disabled={!!editingEmp}
                    required
                  />
                  {!editingEmp && (
                    <button
                      type="button"
                      onClick={handleGenerateCredentials}
                      title="Generate a unique User ID + password"
                      className="px-2.5 py-1.5 rounded-lg bg-[var(--brand-color)]/10 text-[var(--brand-color)] border border-[var(--brand-color)]/30 text-[10px] font-bold hover:bg-[var(--brand-color)]/20 cursor-pointer shrink-0 flex items-center gap-1"
                    >
                      <KeyRound className="w-3 h-3" /> Generate
                    </button>
                  )}
                </div>
                {generatedCreds && (
                  <div className="mt-2 p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-[10px] space-y-0.5">
                    <p className="font-bold">Generated credentials — share with this staff member:</p>
                    <p className="font-mono">ID: <strong>{generatedCreds.userId}</strong></p>
                    <p className="font-mono">Password: <strong>{generatedCreds.password}</strong></p>
                    <p className="text-[9px] text-emerald-600">Shown once. Only the hashed value is stored.</p>
                  </div>
                )}
              </div>

              {/* Role select */}
              <div>
                <label className="block text-[9px] font-bold uppercase text-gray-500 mb-1">Operational Role</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as any)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--color-border-input)] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)]"
                >
                  <option value="Cashier">Cashier (Standard billing access)</option>
                  <option value="Manager">Manager (Billing, catalog & analytics)</option>
                  <option value="Owner">Owner (Global administrator access)</option>
                </select>
              </div>

              {/* Branch assignment */}
              {branches.length > 1 && (
                <div>
                  <label className="block text-[9px] font-bold uppercase text-gray-500 mb-1 flex items-center gap-1">
                    <Building2 className="w-3 h-3" />
                    Assigned Branch
                  </label>
                  <select
                    value={branchId}
                    onChange={(e) => setBranchId(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--color-border-input)] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)]"
                  >
                    {branches.filter(b => b.isActive).map(b => (
                      <option key={b.id} value={b.id}>
                        {b.name} {b.isHeadBranch ? '(Head Office)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* PIN Code */}
              <div>
                <label className="block text-[9px] font-bold uppercase text-gray-500 mb-1">4-Digit Login PIN Code</label>
                <input
                  type="password"
                  maxLength={4}
                  placeholder="e.g., 3333"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--color-border-input)] text-xs font-mono font-bold tracking-widest focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)]"
                  required
                />
              </div>

              {/* Login Password (for User ID + Password sign-in mode) — optional */}
              <div>
                <label className="block text-[9px] font-bold uppercase text-gray-500 mb-1">Login Password (optional)</label>
                <input
                  type="text"
                  minLength={4}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Leave blank to use PIN only"
                  className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--color-border-input)] text-xs font-mono font-bold tracking-widest focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)]"
                />
                <p className="text-[9px] text-gray-400 mt-1">Used by the "User ID + Password" sign-in method. You can leave this blank and use the PIN for quick switching.</p>
              </div>

              {/* Status */}
              {editingEmp && (
                <div>
                  <label className="block text-[9px] font-bold uppercase text-gray-500 mb-1">Access Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as any)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--color-border-input)] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)]"
                  >
                    <option value="Active">Active Authorized</option>
                    <option value="Inactive">Deactivated (Revoked)</option>
                  </select>
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-4 border-t border-gray-100">
              <button
                type="button"
                onClick={() => { setIsAdding(false); setEditingEmp(null); setPassword(''); setGeneratedCreds(null); }}
                className="flex-1 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-xs font-semibold hover:bg-gray-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-1.5 bg-[var(--brand-color)] text-white rounded-lg text-xs font-bold shadow-md cursor-pointer hover:bg-[var(--color-primary-hover)]"
              >
                Save Profile
              </button>
            </div>
          </form>
        ) : (
          /* Login audit trails */
          <div className="p-4 flex flex-col h-full overflow-hidden">
            <div className="border-b border-gray-100 pb-2.5 mb-3 flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-gray-500">
              <Clock className="w-4 h-4 text-[var(--brand-color)]" />
              Staff Security Shift Logs
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-[var(--color-surface-muted)]">
              {sessions.length === 0 ? (
                <div className="py-8 text-center text-xs text-gray-400">
                  No staff records yet. Add your first staff member to see their login history.
                </div>
              ) : (
                sessions.map((ses) => (
                  <div key={ses.id} className="py-2.5 font-sans space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold text-gray-800">{ses.name}</span>
                      <span className="text-[9px] font-semibold text-gray-400 font-mono capitalize">{ses.role}</span>
                    </div>
                    <div className="flex justify-between items-center text-[10px] text-gray-500">
                      <span className="font-medium text-[var(--brand-color)]">Last login</span>
                      <span className="font-mono text-[9px]">{ses.loginTime}</span>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-gray-100 bg-amber-50 p-2.5 rounded-lg border border-amber-200 text-[10px] text-amber-800 flex gap-1.5">
              <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>Shift terminations must be locked, and cash drawers counted before completing logs.</span>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
