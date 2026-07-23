/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Users, Plus, Shield, Check, X, ShieldAlert, User, Clock, Trash2, KeyRound } from 'lucide-react';
import { Employee, LoginSession } from '../src/types';

interface StaffManagerProps {
  employees: Employee[];
  onUpdateEmployees: (updated: Employee[]) => void;
  currentEmployee: Employee;
}

export default function StaffManager({ employees, onUpdateEmployees, currentEmployee }: StaffManagerProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingEmp, setEditingEmp] = useState<Employee | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [uname, setUname] = useState('');
  const [role, setRole] = useState<'Owner' | 'Manager' | 'Cashier'>('Cashier');
  const [pin, setPin] = useState('');
  const [status, setStatus] = useState<'Active' | 'Inactive'>('Active');
  
  const [error, setError] = useState('');

  // Deletion confirmation helper state
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Simulated session logs
  const [sessions, setSessions] = useState<LoginSession[]>([
    { id: 's1', username: 'cashier', name: 'Ravi Singh', role: 'Cashier', loginTime: '2026-07-17 08:30:15', ipAddress: '192.168.1.104' },
    { id: 's2', username: 'manager', name: 'Vansh Rajput', role: 'Manager', loginTime: '2026-07-16 11:15:30', ipAddress: '192.168.1.100' },
    { id: 's3', username: 'owner', name: 'Rajesh Kumar', role: 'Owner', loginTime: '2026-07-15 10:02:45', ipAddress: '192.168.1.99' }
  ]);

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
            status: status
          };
        }
        return emp;
      });
      if (error) return;
      onUpdateEmployees(updated);
    } else {
      // Create mode
      const newEmp: Employee = {
        id: `emp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        name: name.trim(),
        username: uname.trim().toLowerCase(),
        role: role,
        pin: pin.trim(),
        status: 'Active'
      };
      onUpdateEmployees([...employees, newEmp]);
    }

    setIsAdding(false);
    setEditingEmp(null);
    setName('');
    setUname('');
    setPin('');
    setRole('Cashier');
    setStatus('Active');
  };

  const openEditModal = (emp: Employee) => {
    setEditingEmp(emp);
    setName(emp.name);
    setUname(emp.username);
    setRole(emp.role);
    setPin(emp.pin);
    setStatus(emp.status);
    setIsAdding(true);
  };

  const handleDeleteEmployee = (empId: string) => {
    if (empId === currentEmployee.id) {
      alert('You cannot terminate your own active workspace account.');
      return;
    }
    if (deleteConfirmId === empId) {
      onUpdateEmployees(employees.filter(emp => emp.id !== empId));
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
      <div className="flex-1 flex flex-col bg-white rounded-xl border border-[#e1e2ed] shadow-sm overflow-hidden h-full">
        <div className="p-4 border-b border-[#e1e2ed] bg-gray-50 flex justify-between items-center">
          <div className="flex flex-col gap-0.5">
            <h3 className="font-bold text-[#191b23] text-sm">Authorized Terminal Personnel</h3>
            <p className="text-[10px] text-gray-500">Manage shift operators, change quick-access PIN codes, and audit system credentials.</p>
          </div>

          {currentEmployee.role !== 'Cashier' && (
            <button
              onClick={() => { setIsAdding(true); setEditingEmp(null); }}
              className="flex items-center gap-1 bg-[#004ac6] hover:bg-[#003ea8] text-white px-3 py-1.5 rounded-lg font-semibold text-xs transition-colors shadow-sm cursor-pointer"
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
                className={`p-4 rounded-xl border bg-white shadow-sm flex justify-between items-start transition-all ${
                  emp.status === 'Active' ? 'border-[#e1e2ed] hover:shadow-md' : 'border-gray-200 opacity-60 bg-gray-50/50'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#f3f3fe] border border-[#c3c6d7] text-[#004ac6] font-bold text-sm flex items-center justify-center uppercase shadow-inner shrink-0">
                    {emp.name.charAt(0)}
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <strong className="text-xs text-[#191b23] block leading-tight">{emp.name}</strong>
                      {emp.id === currentEmployee.id && (
                        <span className="text-[9px] font-bold bg-[#004ac6] text-white px-1.5 py-0.2 rounded-full uppercase scale-90">
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
                  </div>
                </div>

                {/* PIN and edit panel */}
                {currentEmployee.role !== 'Cashier' && (
                  <div className="flex flex-col items-end gap-2.5">
                    <div className="text-right">
                      <span className="text-[9px] text-gray-400 font-bold block uppercase tracking-wider">PIN Code</span>
                      <strong className="text-xs font-mono font-bold tracking-widest text-[#004ac6] bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100">
                        {emp.pin}
                      </strong>
                    </div>

                    <div className="flex gap-1.5 items-center">
                      <button
                        onClick={() => openEditModal(emp)}
                        className="p-1 text-gray-500 hover:text-[#004ac6] bg-[#faf8ff] hover:bg-[#e7e7f3] rounded border border-[#e1e2ed] text-[10px] font-semibold cursor-pointer"
                      >
                        Modify
                      </button>
                      
                      {emp.id !== currentEmployee.id && (
                        <button
                          onClick={() => handleDeleteEmployee(emp.id)}
                          className={`p-1.5 rounded border text-[10px] font-bold cursor-pointer transition-all ${
                            deleteConfirmId === emp.id
                              ? 'bg-red-600 border-red-600 text-white animate-pulse'
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
      <div className="w-80 bg-white rounded-xl border border-[#e1e2ed] shadow-sm overflow-hidden flex flex-col h-full shrink-0">
        {isAdding && currentEmployee.role !== 'Cashier' ? (
          /* Create or edit form */
          <form onSubmit={handleSaveEmployee} className="p-4 flex flex-col justify-between h-full overflow-y-auto">
            <div className="space-y-4">
              <div className="border-b border-gray-100 pb-2 mb-2">
                <h3 className="font-bold text-[#191b23] text-xs flex items-center gap-1">
                  <Shield className="w-4 h-4 text-[#004ac6]" />
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
                  className="w-full px-2.5 py-1.5 rounded-lg border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#004ac6]"
                  required
                />
              </div>

              {/* ID / Username */}
              <div>
                <label className="block text-[9px] font-bold uppercase text-gray-500 mb-1">Login Username</label>
                <input
                  type="text"
                  placeholder="e.g., ravi_cashier"
                  value={uname}
                  onChange={(e) => setUname(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#004ac6] font-mono lowercase"
                  disabled={!!editingEmp}
                  required
                />
              </div>

              {/* Role select */}
              <div>
                <label className="block text-[9px] font-bold uppercase text-gray-500 mb-1">Operational Role</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as any)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#004ac6]"
                >
                  <option value="Cashier">Cashier (Standard billing access)</option>
                  <option value="Manager">Manager (Billing, catalog & analytics)</option>
                  <option value="Owner">Owner (Global administrator access)</option>
                </select>
              </div>

              {/* PIN Code */}
              <div>
                <label className="block text-[9px] font-bold uppercase text-gray-500 mb-1">4-Digit Login PIN Code</label>
                <input
                  type="password"
                  maxLength={4}
                  placeholder="e.g., 3333"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-[#c3c6d7] text-xs font-mono font-bold tracking-widest focus:outline-none focus:ring-1 focus:ring-[#004ac6]"
                  required
                />
              </div>

              {/* Status */}
              {editingEmp && (
                <div>
                  <label className="block text-[9px] font-bold uppercase text-gray-500 mb-1">Access Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as any)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#004ac6]"
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
                onClick={() => { setIsAdding(false); setEditingEmp(null); }}
                className="flex-1 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-xs font-semibold hover:bg-gray-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-1.5 bg-[#004ac6] text-white rounded-lg text-xs font-bold shadow-md cursor-pointer hover:bg-[#003ea8]"
              >
                Save Profile
              </button>
            </div>
          </form>
        ) : (
          /* Login audit trails */
          <div className="p-4 flex flex-col h-full overflow-hidden">
            <div className="border-b border-gray-100 pb-2.5 mb-3 flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-gray-500">
              <Clock className="w-4 h-4 text-[#004ac6]" />
              Staff Security Shift Logs
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-[#e7e7f3]">
              {sessions.map((ses) => (
                <div key={ses.id} className="py-2.5 font-sans space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-gray-800">{ses.name}</span>
                    <span className="text-[9px] font-semibold text-gray-400 font-mono">{ses.ipAddress}</span>
                  </div>
                  <div className="flex justify-between items-center text-[10px] text-gray-500">
                    <span className="font-medium text-[#004ac6]">{ses.role} opened shift</span>
                    <span className="font-mono text-[9px]">{ses.loginTime}</span>
                  </div>
                </div>
              ))}
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
