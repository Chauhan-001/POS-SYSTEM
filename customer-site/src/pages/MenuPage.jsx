import { useEffect, useMemo, useState } from 'react';
import Header from '../components/Header';
import MenuCard from '../components/MenuCard';
import { Marquee, Squiggle } from '../components/bits';
import { useSession } from '../context/session';

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
    </div>
  );
}
