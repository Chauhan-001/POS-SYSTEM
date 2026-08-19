import { useMemo, useState } from 'react';

/**
 * Customer-site configuration modal (Phase 4).
 *
 * Renders the SAME resolved configuration the POS uses (variant / modifier /
 * add-on groups from the menu payload). The customer picks options; the live
 * total is a display preview only — the server re-validates and re-prices
 * authoritatively at precheck/order time.
 */

const groupLabel = (type) =>
  type === 'VARIANT_GROUP' ? 'Choose' : type === 'ADD_ON_GROUP' ? 'Add-ons' : 'Customize';

function optionPrice(group, option) {
  if (group.type === 'ADD_ON_GROUP') return Number(option.price) || 0;
  return Number(option.priceDelta) || 0;
}

export default function ConfigModal({ item, onClose, onConfirm }) {
  const groups = useMemo(
    () => {
      const config = item.configuration || {};
      return [
        ...(config.variantGroups || []),
        ...(config.modifierGroups || []),
        ...(config.addOnGroups || []),
      ];
    },
    [item.configuration]
  );

  const [selection, setSelection] = useState({ selections: [] });
  const [qty, setQty] = useState(1);
  const [error, setError] = useState('');

  const toggleOption = (group, optionId) => {
    const entry = selection.selections.find((s) => s.groupId === group.id);
    const current = entry?.optionIds || [];
    const isSelected = current.includes(optionId);
    let next;
    if (group.selectionMode === 'SINGLE') {
      next = isSelected && current.length === 1 ? [] : [optionId];
    } else {
      next = isSelected ? current.filter((id) => id !== optionId) : [...current, optionId];
    }
    const rest = selection.selections.filter((s) => s.groupId !== group.id);
    setSelection({
      selections: [...rest, { groupId: group.id, optionIds: next, quantities: entry?.quantities }],
    });
    setError('');
  };

  const setAddonQty = (group, optionId, delta) => {
    const entry = selection.selections.find((s) => s.groupId === group.id);
    const current = entry?.optionIds || [];
    const quantities = { ...(entry?.quantities || {}) };
    const option = (group.options || []).find((o) => o.id === optionId);
    const max = option?.maxQuantity ?? 99;
    const cur = Math.max(1, Number(quantities[optionId]) || 1);
    const nextQty = Math.max(1, Math.min(max, cur + delta));
    if (!current.includes(optionId)) {
      // First tap adds it at qty 1.
      quantities[optionId] = 1;
      const rest = selection.selections.filter((s) => s.groupId !== group.id);
      setSelection({ selections: [...rest, { groupId: group.id, optionIds: [...current, optionId], quantities }] });
      return;
    }
    if (nextQty <= 0) return;
    if (nextQty <= 1) delete quantities[optionId];
    else quantities[optionId] = nextQty;
    const rest = selection.selections.filter((s) => s.groupId !== group.id);
    setSelection({ selections: [...rest, { groupId: group.id, optionIds: current, quantities }] });
  };

  const unitTotal = useMemo(() => {
    let base = Number(item.price) || 0;
    let delta = 0;
    for (const group of groups) {
      const entry = selection.selections.find((s) => s.groupId === group.id);
      for (const optionId of entry?.optionIds || []) {
        const option = (group.options || []).find((o) => o.id === optionId);
        if (!option || option.active === false) continue;
        const p = optionPrice(group, option);
        if (group.type === 'ADD_ON_GROUP') {
          delta += p * (Number(entry.quantities?.[optionId]) || 1);
        } else {
          delta += p;
        }
      }
    }
    return base + delta;
  }, [selection, groups, item.price]);

  const configSummary = useMemo(() => {
    const parts = [];
    for (const group of groups) {
      const entry = selection.selections.find((s) => s.groupId === group.id);
      for (const optionId of entry?.optionIds || []) {
        const option = (group.options || []).find((o) => o.id === optionId);
        if (!option) continue;
        const q = group.type === 'ADD_ON_GROUP' ? Number(entry.quantities?.[optionId]) || 1 : 1;
        parts.push(q > 1 ? `${option.name} ×${q}` : option.name);
      }
    }
    return parts.join(' • ');
  }, [selection, groups]);

  const handleConfirm = () => {
    const errors = [];
    for (const group of groups) {
      const entry = selection.selections.find((s) => s.groupId === group.id);
      const count = entry?.optionIds?.length || 0;
      if (group.required && count === 0) errors.push(`Please choose ${groupLabel(group.type).toLowerCase()} for ${group.name}.`);
      else if (group.minSelections > 0 && count < group.minSelections) errors.push(`Select at least ${group.minSelections} for ${group.name}.`);
      else if (group.maxSelections != null && count > group.maxSelections) errors.push(`Select at most ${group.maxSelections} for ${group.name}.`);
    }
    if (errors.length > 0) {
      setError(errors[0]);
      return;
    }
    onConfirm({
      selections: selection.selections.filter((s) => s.optionIds.length > 0),
      configSummary,
      unitTotal,
    });
  };

  const hasConfig = groups.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-6" onClick={onClose}>
      <div
        className="w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-4 pb-3 border-b border-gray-100 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-bold text-lg leading-tight">{item.name}</h3>
            <p className="text-sm text-gray-500">Starting ₹{(Number(item.price) || 0).toFixed(2)}</p>
          </div>
          <button className="text-2xl leading-none text-gray-400 hover:text-gray-700 px-1" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="px-5 py-3 overflow-y-auto space-y-5">
          {!hasConfig && <p className="text-sm text-gray-500">This item has no options.</p>}
          {groups.map((group) => {
            const entry = selection.selections.find((s) => s.groupId === group.id);
            const selectedIds = entry?.optionIds || [];
            return (
              <div key={group.id}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-semibold text-sm">{group.name}</span>
                  {group.required && (
                    <span className="text-[10px] font-bold uppercase tracking-wide bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                      Required
                    </span>
                  )}
                  {group.selectionMode === 'SINGLE' && (
                    <span className="text-[10px] text-gray-400">choose one</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(group.options || [])
                    .filter((o) => o.active !== false)
                    .map((option) => {
                      const selected = selectedIds.includes(option.id);
                      const p = optionPrice(group, option);
                      const isAddon = group.type === 'ADD_ON_GROUP';
                      const addonQty = isAddon ? Number(entry?.quantities?.[option.id]) || (selected ? 1 : 0) : 0;
                      return (
                        <div key={option.id} className="flex flex-col items-stretch">
                          <button
                            className={`px-3 py-2 rounded-xl border text-sm font-medium transition-all ${
                              selected
                                ? 'border-blue-600 bg-blue-600 text-white shadow'
                                : 'border-gray-200 bg-white text-gray-800 hover:border-blue-300'
                            }`}
                            onClick={() => (isAddon ? setAddonQty(group, option.id, 1) : toggleOption(group, option.id))}
                          >
                            {option.name}
                            <span className={selected ? 'text-blue-100' : 'text-gray-400'}>{'  '}
                              {p > 0 ? `+₹${p.toFixed(2)}` : p < 0 ? `−₹${Math.abs(p).toFixed(2)}` : ''}
                            </span>
                          </button>
                          {isAddon && selected && (
                            <div className="flex items-center justify-center gap-2 mt-1.5">
                              <button className="w-6 h-6 rounded-full border text-sm leading-none" onClick={() => setAddonQty(group, option.id, -1)}>
                                −
                              </button>
                              <span className="text-sm font-semibold w-4 text-center">{addonQty}</span>
                              <button className="w-6 h-6 rounded-full border text-sm leading-none" onClick={() => setAddonQty(group, option.id, 1)}>
                                +
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            );
          })}

          {error && <p className="text-sm text-red-600 font-medium">⚠️ {error}</p>}

          {configSummary && (
            <p className="text-xs text-gray-500 border-t border-dashed border-gray-200 pt-3">
              {configSummary}
            </p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex items-center gap-4">
          <div className="flex items-center gap-2 border rounded-xl px-2 py-1">
            <button className="w-7 h-7 rounded-full text-lg leading-none hover:bg-gray-100" onClick={() => setQty((q) => Math.max(1, q - 1))}>
              −
            </button>
            <span className="w-5 text-center font-bold">{qty}</span>
            <button className="w-7 h-7 rounded-full text-lg leading-none hover:bg-gray-100" onClick={() => setQty((q) => q + 1)}>
              +
            </button>
          </div>
          <button
            className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl transition-all disabled:opacity-50"
            onClick={handleConfirm}
          >
            Add {qty} × ₹{(unitTotal * qty).toFixed(2)}
          </button>
        </div>
      </div>
    </div>
  );
}
