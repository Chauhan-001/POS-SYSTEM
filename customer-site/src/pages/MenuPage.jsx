import { useEffect, useMemo, useState } from 'react';
import Header from '../components/Header';
import MenuCard from '../components/MenuCard';
import { Marquee, Squiggle } from '../components/bits';
import { useSession } from '../context/session';

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
  const { qr, ensureMenu, addToCart, showToast } = useSession();
  const [menu, setMenu] = useState(null);
  const [error, setError] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    ensureMenu()
      .then(setMenu)
      .catch(() => setError('Menu failed to load — try again.'));
  }, [ensureMenu]);

  const handleAdd = (item) => {
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
    </div>
  );
}
