import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { api, errMsg, setToken } from '../api';
import CarForm from '../pages/CarForm';
import WaiterFab from '../components/WaiterFab';
import { SessionContext } from './session';

/**
 * SessionProvider — boots a QR storefront against the POS backend's
 * public-store API. There is no server-side "session" object: the QR URL
 * carries the restaurant token + ordering context (mode/ref), the cart lives
 * in localStorage, and every order is idempotency-keyed with a clientRef that
 * doubles as the tracking handle.
 */

const cartKey = (token, mode, ref) => `qr_cart_${token}_${mode}_${ref || 'guest'}`;
const refKey = (token, mode, ref) => `qr_ref_${token}_${mode}_${ref || 'guest'}`;
const CUSTOMER_KEY = 'qr_customer';

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function SessionProvider({ token }) {
  const [search] = useSearchParams();
  const mode = (search.get('mode') || 'table').toUpperCase(); // TABLE | CAR | PICKUP
  const ref = search.get('ref') || '';
  const tableNo = search.get('t') || ''; // human-friendly table number (QR Studio bakes it in)
  const branchId = search.get('b') || ''; // branch-scoped menu (QR Studio bakes it in)

  const [qr, setQr] = useState(null);
  const [phase, setPhase] = useState('loading'); // loading | need-car | ready | error
  const [error, setError] = useState('');
  const [cart, setCart] = useState(() => loadJSON(cartKey(token, mode, ref), []));
  // Menu is cached per branch — a stale cache would leak one branch's SOLD OUT
  // states into another branch's view when switching stickers in the same tab.
  const [menuCache, setMenuCache] = useState({ branch: '', data: null });
  const [customer, setCustomer] = useState(() => loadJSON(CUSTOMER_KEY, null));
  const [clientRef, setClientRef] = useState(() => localStorage.getItem(refKey(token, mode, ref)) || null);
  const [toast, setToast] = useState(null);
  const bootRef = useRef(false);
  const toastTimer = useRef(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  /* ------------------------- boot: resolve store + mode ------------------ */
  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;
    setToken(token);

    (async () => {
      try {
        const { data } = await api.get('/'); // store config
        setQr({
          token,
          type: mode.toLowerCase(),
          tableId: mode === 'TABLE' ? ref || undefined : undefined,
          tableNumber: mode === 'TABLE' ? Number(tableNo) || undefined : undefined,
          parkingSlot: mode === 'CAR' ? ref || undefined : undefined,
          branchId: branchId || undefined,
          restaurant: data.store || {},
        });
        // Car mode needs driver details before ordering (drive-off prevention).
        setPhase(mode === 'CAR' && !loadJSON(CUSTOMER_KEY, null) ? 'need-car' : 'ready');
      } catch (err) {
        setError(errMsg(err, 'Could not open this QR code'));
        setPhase('error');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, mode, ref]);

  /* ------------------------------ cart persist --------------------------- */
  useEffect(() => {
    localStorage.setItem(cartKey(token, mode, ref), JSON.stringify(cart));
  }, [cart, token, mode, ref]);

  /* --------------------------------- cart ops ---------------------------- */
  const addToCart = useCallback((line) => {
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.productId === line.productId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + line.qty };
        return next;
      }
      return [...prev, line];
    });
  }, []);

  const updateQty = useCallback((index, qty) => {
    setCart((prev) =>
      qty <= 0 ? prev.filter((_, i) => i !== index) : prev.map((l, i) => (i === index ? { ...l, qty } : l))
    );
  }, []);

  const removeLine = useCallback((index) => {
    setCart((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearCart = useCallback(() => setCart([]), []);

  /* ------------------------------ menu (cached) -------------------------- */
  const ensureMenu = useCallback(async () => {
    if (menuCache.data && menuCache.branch === branchId) return menuCache.data;
    const { data } = await api.get('/menu', {
      params: branchId ? { branchId } : undefined,
    });
    setMenuCache({ branch: branchId, data });
    return data;
  }, [menuCache, branchId]);

  /* --------------------------- car mode submit --------------------------- */
  const submitCar = useCallback((carInfo) => {
    setCustomer(carInfo);
    localStorage.setItem(CUSTOMER_KEY, JSON.stringify(carInfo));
    setPhase('ready');
  }, []);

  /* --------------------------- place an order ---------------------------- */
  const placeOrder = useCallback(
    async ({ name, phone, notes, tip }) => {
      if (cart.length === 0) throw new Error('Cart is empty');

      // A FRESH ref per submission. The backend is idempotent on clientRef, so
      // reusing a stored one would make the second "add more food" order replay
      // the first instead of creating a new order. The stored ref (set below)
      // tracks the LAST placed order; the next submission mints a new one.
      const clientRefValue =
        `qr_${token.slice(0, 8)}_${mode}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

      const body = {
        items: cart.map((l) => ({ productId: l.productId, quantity: l.qty })),
        mode,
        branchId: branchId || qr?.branchId || undefined,
        tableId: mode === 'TABLE' ? qr?.tableId || undefined : undefined,
        tableNumber: mode === 'TABLE' ? qr?.tableNumber || undefined : undefined,
        parkingSlot: mode === 'CAR' ? qr?.parkingSlot || customer?.parkingSlot || undefined : undefined,
        carPlate: mode === 'CAR' ? customer?.carNumber || undefined : undefined,
        customer: { name: name || customer?.name, phone: phone || customer?.phone },
        notes: notes || undefined,
        tip: Number(tip) || 0,
        clientRef: clientRefValue,
      };

      const { data } = await api.post('/orders', body);
      localStorage.setItem(refKey(token, mode, ref), clientRefValue);
      setClientRef(clientRefValue);
      setCart([]);
      return { order: data.order, clientRef: clientRefValue };
    },
    [cart, clientRef, customer, mode, qr, ref, token, branchId]
  );

  /* ---------------------------- live tracking ---------------------------- */
  const trackOrder = useCallback(async () => {
    if (!clientRef) return null;
    const { data } = await api.get(`/orders/${encodeURIComponent(clientRef)}`);
    return data;
  }, [clientRef]);

  /* ----------------------------- waiter calls ---------------------------- */
  const waiterCall = useCallback(
    async ({ type, message }) => {
      await api.post('/requests', {
        mode,
        tableId: mode === 'TABLE' ? qr?.tableId || undefined : undefined,
        parkingSlot: mode === 'CAR' ? qr?.parkingSlot || customer?.parkingSlot || undefined : undefined,
        carPlate: mode === 'CAR' ? customer?.carNumber || undefined : undefined,
        name: customer?.name,
        phone: customer?.phone,
        type,
        message: message || undefined,
      });
    },
    [customer, mode, qr]
  );

  const value = useMemo(
    () => ({
      token,
      qr,
      type: qr?.type || mode.toLowerCase(),
      cart,
      addToCart,
      updateQty,
      removeLine,
      clearCart,
      menu: menuCache.data,
      ensureMenu,
      showToast,
      customer,
      submitCar,
      placeOrder,
      trackOrder,
      waiterCall,
      clientRef,
    }),
    [
      token, qr, mode, cart, addToCart, updateQty, removeLine, clearCart,
      menuCache, ensureMenu, showToast, customer, submitCar, placeOrder,
      trackOrder, waiterCall, clientRef,
    ]
  );

  /* --------------------------------- phases ------------------------------ */
  if (phase === 'loading') {
    return (
      <div className="shell">
        <div className="loader-wrap">
          <div>
            <span className="loader-emoji">🍔</span>
            <h2 className="display" style={{ transform: 'rotate(-2deg)' }}>
              Firing up the grill…
            </h2>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="shell">
        <div className="page">
          <h1 className="hero-title">
            QR <span className="bolt">Ordering</span> ⚡
          </h1>
          <div className="error-box mt">
            <p style={{ margin: '0 0 6px' }}>😵 Oops — this QR didn’t work.</p>
            <p className="muted" style={{ margin: 0 }}>
              {error}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'need-car') {
    return <CarForm qr={qr} onSubmit={submitCar} />;
  }

  return (
    <SessionContext.Provider value={value}>
      <div className="shell">
        <Outlet />
      </div>
      {(qr?.type === 'table' || qr?.type === 'car') && <WaiterFab />}
      <AnimatePresence>
        {toast && (
          <motion.div
            className="toast"
            initial={{ y: 60, opacity: 0, x: '-50%' }}
            animate={{ y: 0, opacity: 1, x: '-50%' }}
            exit={{ y: 60, opacity: 0, x: '-50%' }}
            transition={{ type: 'spring', stiffness: 400, damping: 28 }}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </SessionContext.Provider>
  );
}
