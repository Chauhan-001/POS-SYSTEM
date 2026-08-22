import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * Customer-site configuration modal — retro diner theme.
 *
 * Opens as a bottom sheet when a product has variants / modifiers / add-ons.
 * The customer picks options; the live total is a display preview only — the
 * server re-validates and re-prices authoritatively at precheck/order time.
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
    <motion.div
      className="config-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="config-sheet"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-handle" />

        {/* Header */}
        <div className="config-header">
          <div>
            <h3 className="sheet-title" style={{ marginBottom: 0 }}>{item.name}</h3>
            <span className="config-starting-price">Starting ₹{(Number(item.price) || 0).toFixed(2)}</span>
          </div>
          <button className="config-close-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {/* Options body */}
        <div className="config-body">
          {!hasConfig && <p className="muted" style={{ margin: 0 }}>This item has no options.</p>}

          {groups.map((group) => {
            const entry = selection.selections.find((s) => s.groupId === group.id);
            const selectedIds = entry?.optionIds || [];
            return (
              <div key={group.id} className="config-group">
                <div className="config-group-header">
                  <span className="config-group-name">{group.name}</span>
                  {group.required && (
                    <span className="config-required-badge">Required</span>
                  )}
                  {group.selectionMode === 'SINGLE' && (
                    <span className="config-hint">choose one</span>
                  )}
                </div>
                <div className="config-options">
                  {(group.options || [])
                    .filter((o) => o.active !== false)
                    .map((option) => {
                      const selected = selectedIds.includes(option.id);
                      const p = optionPrice(group, option);
                      const isAddon = group.type === 'ADD_ON_GROUP';
                      const addonQty = isAddon ? Number(entry?.quantities?.[option.id]) || (selected ? 1 : 0) : 0;
                      return (
                        <div key={option.id} className="config-option-wrap">
                          <button
                            className={`config-option${selected ? ' selected' : ''}`}
                            onClick={() => (isAddon ? setAddonQty(group, option.id, 1) : toggleOption(group, option.id))}
                          >
                            <span>{option.name}</span>
                            {p !== 0 && (
                              <span className={selected ? 'config-price-on' : 'config-price'}>
                                {p > 0 ? `+₹${p.toFixed(2)}` : `−₹${Math.abs(p).toFixed(2)}`}
                              </span>
                            )}
                          </button>
                          {isAddon && selected && (
                            <div className="config-addon-qty">
                              <button className="config-qty-btn" onClick={() => setAddonQty(group, option.id, -1)}>−</button>
                              <span className="config-qty-val">{addonQty}</span>
                              <button className="config-qty-btn" onClick={() => setAddonQty(group, option.id, 1)}>+</button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            );
          })}

          {error && <p className="config-error">⚠️ {error}</p>}

          {configSummary && (
            <div className="config-summary">
              {configSummary}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="config-footer">
          <div className="config-footer-price">
            <span className="config-footer-label">Total</span>
            <span className="price">₹{unitTotal.toFixed(2)}</span>
          </div>
          <motion.button
            className="btn btn-ketchup btn-block"
            whileTap={{ scale: 0.96 }}
            onClick={handleConfirm}
          >
            Add to tray ✓
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}
