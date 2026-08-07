/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Keyboard, X, Info } from 'lucide-react';

interface ShortcutsGuideProps {
  onClose: () => void;
}

export default function ShortcutsGuide({ onClose }: ShortcutsGuideProps) {
  const keyboardShortcuts = [
    { key: 'F1', desc: 'Focus Product Search input immediately' },
    { key: 'F2', desc: 'Focus Customer Phone Number input for loyalty check' },
    { key: 'F9', desc: 'Complete Bill Payment (triggers payment overlay / receipt)' },
    { key: 'F4', desc: 'Quick-print last invoice' },
    { key: 'F8', desc: 'Hold current order' },
    { key: 'F10', desc: 'Recall held orders drawer' },
    { key: 'Esc', desc: 'Clear search, close overlays, or void current cart inputs' },
    { key: '+ / -', desc: 'Adjust quantities for selected products inside cart list' },
    { key: 'Del / Backspace', desc: 'Remove highlighted product row from current bill' }
  ];

  return (
    <div className="fixed inset-0 bg-[#191b23]/75 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full border border-[#e1e2ed] overflow-hidden">
        
        {/* Header */}
        <div className="bg-[#f3f3fe] px-6 py-4 border-b border-[#e1e2ed] flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Keyboard className="w-5 h-5 text-[#004ac6]" />
            <h3 className="font-bold text-[#191b23]">Cashier Keyboard Shortcuts</h3>
          </div>
          <button 
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 focus:outline-none cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Shortcuts list */}
        <div className="p-6 space-y-4">
          <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-xs flex gap-2">
            <Info className="w-4.5 h-4.5 shrink-0 mt-0.5 text-amber-600" />
            <span>
              Keyboard shortcuts are global. They let cashiers complete transactions in less than 15 seconds without lifting hands to use the mouse!
            </span>
          </div>

          <div className="divide-y divide-[#e7e7f3] text-sm">
            {keyboardShortcuts.map((shortcut) => (
              <div key={shortcut.key} className="flex justify-between items-center py-2.5">
                <span className="text-[#505f76] text-xs font-medium">{shortcut.desc}</span>
                <kbd className="px-2.5 py-1 text-xs font-mono font-bold bg-[#faf8ff] text-[#004ac6] border border-[#c3c6d7] rounded shadow-sm">
                  {shortcut.key}
                </kbd>
              </div>
            ))}
          </div>

          <button
            onClick={onClose}
            className="w-full mt-2 bg-[#004ac6] hover:bg-[#003ea8] text-white py-2 rounded-lg font-semibold text-xs transition-colors cursor-pointer"
          >
            Got It, Resume Billing
          </button>
        </div>

      </div>
    </div>
  );
}
