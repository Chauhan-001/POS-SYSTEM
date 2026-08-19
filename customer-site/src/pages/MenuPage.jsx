import { useEffect, useMemo, useState } from 'react';
import Header from '../components/Header';
import MenuCard from '../components/MenuCard';
import OfferCard from '../components/OfferCard';
import ConfigModal from '../components/ConfigModal';
import { Marquee, Squiggle } from '../components/bits';
import { useSession } from '../context/session';

/**
 * Phase C — a published promotion creative shown to the customer. Presentation
 * only: tapping the CTA scrolls to the offers list, where applying the linked
 * offer always goes through the server-authoritative check.
 */
function PromoBanner({ promo, onApply }) {
  const c = promo.creative || {};
  const colors = c.colors || { background: '#0b2a5b', text: '#ffffff', accent: '#f59e0b' };
  // Per-screen override first (hero-banner = the customer website banner),
  // falling back to the shared creative image.
  const img = (c.screenImages && c.screenImages['hero-banner'] && c.screenImages['hero-banner'].key) || c.imageKey;
  const title = c.title || promo.name || 'Special offer';
  const subtitle = c.subtitle || '';
  const desc = c.description || '';
  const cta = c.cta || 'Order Now';
  const offer = promo.offer || {};
  const discount = offer.discountDisplay || '';
  const badge = discount ? `🏷️ ${discount}` : null;

  return (
    <div
      className="promo-banner"
      style={{ background: colors.background, color: colors.text }}
      role="button"
      tabIndex={0}
      onClick={onApply}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onApply(); } }}
      aria-label={`${title} — ${discount || 'promotion'}. View offer`}
    >
      {img && <img className="promo-banner-img" src={img} alt="" loading="lazy" />}
      <div className="promo-banner-body">
        {badge && <span className="promo-badge" style={{ background: colors.accent, color: colors.background }}>{badge}</span>}
        <h2 className="promo-title" style={{ color: colors.text }}>{title}</h2>
        {subtitle && <p className="promo-sub" style={{ color: colors.text }}>{subtitle}</p>}
        {desc && <p className="promo-desc" style={{ color: colors.text }}>{desc}</p>}
        <span className="promo-cta" style={{ background: colors.accent, color: colors.background }}>
          {cta} →
        </span>
      </div>
    </div>
  );
}


const LEGAL_BASE = `${window.location.protocol}//${window.location.hostname}:3002/api/legal`;

/** Footer links + modal that show the restaurant's published legal documents
 *  (served from the backend — the POS is never the source of legal text). */
function LegalLinks() {
  const [open, setOpen] = useState(null); // 'privacy_policy' | 'customer_terms' | 'refund_policy' | null
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(false);

  const openDoc = async (type) => {
    setOpen(type);
    setLoading(true);
    setDoc(null);
    try {
      const res = await fetch(`${LEGAL_BASE}/current/${type}`);
      const data = await res.json();
      if (res.ok && data?.content) setDoc(data);
    } catch {
      /* backend unreachable — show nothing */
    } finally {
      setLoading(false);
    }
  };

  const links = [
    { type: 'privacy_policy', label: 'Privacy' },
    { type: 'customer_terms', label: 'Terms' },
    { type: 'refund_policy', label: 'Refunds' },
  ];

  return (
    <>
      <div className="legal-links">
        {links.map((l) => (
          <button key={l.type} className="legal-link" onClick={() => openDoc(l.type)}>
            {l.label}
          </button>
        ))}
      </div>
      {open && (
        <div className="legal-modal" onClick={() => setOpen(null)}>
          <div className="legal-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="legal-modal-head">
              <h3>{doc ? doc.title : 'Legal'}</h3>
              <button className="legal-close" onClick={() => setOpen(null)}>✕</button>
            </div>
            <div className="legal-modal-body">
              {loading && <p className="muted">Loading…</p>}
              {!loading && !doc && <p className="muted">Document not available yet.</p>}
              {!loading && doc && (
                <pre className="legal-text">{doc.content}</pre>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Menu page: category chip rail, search, staggered item cards, SOLD OUT. */
export default function MenuPage() {
  const { qr, ensureMenu, addToCart, showToast, offers, ensureOffers, promotions, ensurePromotions, appliedOffer, applyOffer, removeOffer } = useSession();
  const [menu, setMenu] = useState(null);
  const [error, setError] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    ensureMenu()
      .then(setMenu)
      .catch(() => setError('Menu failed to load — try again.'));
  }, [ensureMenu]);

  // Phase B — discover public offers alongside the menu.
  useEffect(() => {
    ensureOffers().catch(() => {});
  }, [ensureOffers]);

  // Phase C — published promotion creatives (banner above the offers).
  useEffect(() => {
    ensurePromotions().catch(() => {});
  }, [ensurePromotions]);

  // Phase 4 — configured items open the same resolved-configuration picker
  // the POS uses; simple items still add instantly.
  const [configItem, setConfigItem] = useState(null);

  const handleAdd = (item) => {
    if (item.hasConfiguration) {
      setConfigItem(item);
      return;
    }
    addToCart({
      productId: item.id,
      name: item.name,
      price: Number(item.price) || 0,
      gstPercent: Number(item.gstPercent) || 5,
      image: item.image || null,
      qty: 1,
    });
    showToast(`🍽️ ${item.name} added!`);
  };

  const handleConfigConfirm = (configItem_, result) => {
    setConfigItem(null);
    addToCart({
      productId: configItem_.id,
      name: configItem_.name,
      price: Number(result.unitTotal) || Number(configItem_.price) || 0,
      basePrice: Number(configItem_.price) || 0,
      gstPercent: Number(configItem_.gstPercent) || 5,
      image: configItem_.image || null,
      qty: 1,
      configuration: { selections: result.selections },
      configSummary: result.configSummary || undefined,
    });
    showToast(`🍽️ ${configItem_.name} added!`);
  };

  /** Apply an offer from the menu; toast the server's verdict. */
  const handleApply = async (offer) => {
    try {
      const result = await applyOffer(offer);
      if (result?.ok) {
        showToast(`🏷️ ${offer.title} applied!`);
      } else {
        showToast(result?.reason || 'This offer cannot be applied to your cart right now.');
      }
    } catch {
      showToast('Could not apply the offer — try again.');
    }
  };

  /** Combo: add every combo item once, then apply the combo offer. */
  const handleAddCombo = async (offer) => {
    if (Array.isArray(offer.comboItems) && offer.comboItems.length > 0) {
      offer.comboItems.forEach((it) => {
        addToCart({
          productId: it.id,
          name: it.name,
          price: Number(it.price) || 0,
          gstPercent: 5,
          image: it.image || null,
          qty: 1,
        });
      });
    }
    try {
      const result = await applyOffer(offer);
      if (result?.ok) {
        showToast(`🧺 ${offer.title} added!`);
      } else {
        showToast(result?.reason || 'Combo could not be applied right now.');
      }
    } catch {
      showToast('Could not apply the combo — try again.');
    }
  };

  const sections = useMemo(() => {
    if (!menu?.categories) return [];
    const q = query.trim().toLowerCase();
    return menu.categories
      .filter((c) => categoryId === 'all' || c.name === categoryId)
      .map((c) => ({
        category: c,
        // Keep unavailable items in the list — MenuCard renders them with a
        // SOLD OUT tag instead of an Add button. Only the search query filters.
        items: (c.items || []).filter((i) => !q || i.name.toLowerCase().includes(q)),
      }))
      .filter((s) => s.items.length > 0);
  }, [menu, categoryId, query]);

  return (
    <div className="page">
      <Header />
      <Marquee />

      <div className="row mb">
        <input
          className="input"
          placeholder="Search cravings… 🍔"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {/* Phase C — published promotion creatives (presentation only; applying
          still goes through the authoritative offer flow below) */}
      {promotions && promotions.length > 0 && (
        <section className="promo-section">
          {promotions.slice(0, 3).map((p) => (
            <PromoBanner
              key={p.id}
              promo={p}
              onApply={() => {
                // Scroll to the offers and let the customer apply there — the
                // creative never bypasses the server-authoritative offer check.
                const el = document.getElementById('offers-section');
                if (el) el.scrollIntoView({ behavior: 'smooth' });
              }}
            />
          ))}
        </section>
      )}

      {/* Phase B — live offers the customer can actually use right now */}
      {offers && offers.length > 0 && (
        <section className="offers-section" id="offers-section">
          <h2 className="category-title">
            Today’s offers 🏷️
          </h2>
          <div className="offers-grid">
            {offers.map((offer) => (
              <OfferCard
                key={offer.id}
                offer={offer}
                applied={appliedOffer?.id === offer.id}
                onApply={handleApply}
                onAddCombo={handleAddCombo}
              />
            ))}
          </div>
          {appliedOffer && (
            <button className="muted offer-clear" style={{ background: 'none', border: 'none', textDecoration: 'underline', marginTop: 6 }} onClick={removeOffer}>
              Remove applied offer
            </button>
          )}
        </section>
      )}

      <div className="chip-rail">
        <button
          className={`chip${categoryId === 'all' ? ' active' : ''}`}
          onClick={() => setCategoryId('all')}
        >
          All ⚡
        </button>
        {menu?.categories.map((c) => (
          <button
            key={c.name}
            className={`chip${categoryId === c.name ? ' active' : ''}`}
            onClick={() => setCategoryId(c.name)}
          >
            {c.name}
          </button>
        ))}
      </div>

      {error && <div className="error-box">{error}</div>}

      {!menu && !error && (
        <div className="loader-wrap">
          <div>
            <span className="loader-emoji">🍟</span>
            <h2 className="display">Loading the good stuff…</h2>
          </div>
        </div>
      )}

      {sections.map(({ category, items }, si) => (
        <section key={category.name}>
          <h2 className="category-title">{category.name}</h2>
          <div className="menu-grid">
            {items.map((item, i) => (
              <MenuCard key={item.id} item={item} index={si * 3 + i} onAdd={handleAdd} />
            ))}
          </div>
        </section>
      ))}

      {menu && sections.length === 0 && (
        <div className="empty-state">
          <span className="big-emoji">🕵️</span>
          <h2 className="display">Nothing matches…</h2>
          <p className="muted">Try a different search or category.</p>
        </div>
      )}

      <Squiggle />
      <p className="muted center">
        {qr?.restaurant?.name} · GST added at checkout.
      </p>
      <LegalLinks />

      {configItem && (
        <ConfigModal
          item={configItem}
          onClose={() => setConfigItem(null)}
          onConfirm={(result) => handleConfigConfirm(configItem, result)}
        />
      )}
    </div>
  );
}
