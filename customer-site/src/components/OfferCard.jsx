/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * OfferCard — customer-facing offer discovery card (Phase B). Shows only what
 * a customer needs: the discount, what it applies to, when it's valid, and a
 * clear CTA. Never exposes costs, margins, inventory or internal fields.
 *
 * CTAs:
 *   - Combo offers → [Add Combo] (adds the combo items + applies the offer)
 *   - Applicable offers → [Apply]
 *   - Coupon codes → [Copy Code]
 */

import { useState } from 'react';

function copyText(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(() => {});
  }
}

/** Plain-language offer summary built from the backend's safe payload. */
function OfferTerms({ offer }) {
  const terms = offer.terms || [];
  return (
    <div className="offer-terms">
      {terms.map((t, i) => (
        <span key={i} className="offer-term">{t}</span>
      ))}
    </div>
  );
}

export default function OfferCard({ offer, applied, onApply, onAddCombo }) {
  const [copied, setCopied] = useState(false);
  const isCombo = offer.type === 'combo';
  const badge = offer.discountDisplay || '';

  const handleCopy = (e) => {
    e.stopPropagation();
    copyText(offer.couponCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={`offer-card${applied ? ' applied' : ''}`}>
      {offer.imageUrl && <img className="offer-card-img" src={offer.imageUrl} alt="" loading="lazy" />}
      <div className="offer-card-body">
        <div className="offer-card-head">
          <span className="offer-badge">{badge}</span>
          {applied && <span className="offer-applied-tag">✓ Applied</span>}
        </div>
        <div className="menu-name">{offer.title}</div>
        {offer.shortDescription || offer.description ? (
          <p className="muted offer-desc">{offer.shortDescription || offer.description}</p>
        ) : null}

        {isCombo && Array.isArray(offer.comboItems) && offer.comboItems.length > 0 && (
          <div className="combo-items">
            {offer.comboItems.map((it) => (
              <span key={it.id} className="combo-item">{it.name}</span>
            ))}
            {offer.comboPrice > 0 && (
              <span className="combo-price">
                <strong>₹{Number(offer.comboPrice).toFixed(2)}</strong>
                {offer.customerSavings > 0 && (
                  <em className="combo-save">Save ₹{Number(offer.customerSavings).toFixed(2)}</em>
                )}
              </span>
            )}
          </div>
        )}

        <OfferTerms offer={offer} />

        <div className="offer-card-actions">
          {isCombo ? (
            <button className="btn btn-mustard btn-sm" onClick={() => onAddCombo?.(offer)}>
              Add Combo +
            </button>
          ) : (
            <button className="btn btn-mustard btn-sm" onClick={() => onApply?.(offer)} disabled={applied}>
              {applied ? 'Applied' : 'Apply'}
            </button>
          )}
          {offer.couponCode && (
            <button className="btn btn-ghost btn-sm" onClick={handleCopy}>
              {copied ? 'Copied ✓' : `Copy Code ${offer.couponCode}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
