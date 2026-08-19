import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet } from 'react-router-dom';
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
const offerKey = (token, mode, ref) => `qr_offer_${token}_${mode}_${ref || 'guest'}`;
const CUSTOMER_KEY = 'qr_customer';

/**
 * Stable per-scan seat session id (per tab, survives reloads). The server
 * reserves the scanned table under this id — first scan wins, an abandoned
 * scan expires, and cart activity extends the reservation via heartbeat.
 */
function loadSeatSessionId(token, mode, ref) {
  const key = `qr_seat_${token}_${mode}_${ref || 'guest'}`;
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const fresh =
      `seat_${token.slice(0, 8)}_${mode.toLowerCase()}_${Date.now().toString(36)}_` +
      Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem(key, fresh);
    return fresh;
  } catch {
    return `seat_${token.slice(0, 8)}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function SessionProvider({ token }) {
  // QR context is SNAPSHOTTED at mount: in-app navigation (cart/track) uses
  // relative paths that drop the hash query string, so reading mode/ref live
  // from useSearchParams would silently reset a pickup/car QR to TABLE mode
  // and lose the table/slot/branch context by the time the order is placed.
  const [ctx] = useState(() => {
    const search = new URLSearchParams(window.location.hash.split('?')[1] || '');
    return {
      mode: (search.get('mode') || 'table').toUpperCase(), // TABLE | CAR | PICKUP
      ref: search.get('ref') || '',
      tableNo: search.get('t') || '', // human-friendly table number (QR Studio bakes it in)
      branchId: search.get('b') || '', // branch-scoped menu (QR Studio bakes it in)
    };
  });
  const { mode, ref, tableNo, branchId } = ctx;

  const [qr, setQr] = useState(null);
  const [phase, setPhase] = useState('loading'); // loading | need-car | ready | error
  const [error, setError] = useState('');
  // True when the error is a table already being used by another guest (or a
  // live order) — the error screen then explains the seating situation.
  const [tableBusy, setTableBusy] = useState(false);
  const [cart, setCart] = useState(() => loadJSON(cartKey(token, mode, ref), []));
  // Menu is cached per branch — a stale cache would leak one branch's SOLD OUT
  // states into another branch's view when switching stickers in the same tab.
  const [menuCache, setMenuCache] = useState({ branch: '', data: null });
  // Phase B — public offers + the customer's applied offer (persisted per cart).
  const [offers, setOffers] = useState(null); // null = not loaded yet
  const [offersError, setOffersError] = useState('');
  // Phase C — published Promotion Studio creatives (presentation only).
  const [promotions, setPromotions] = useState(null); // null = not loaded yet
  const [appliedOffer, setAppliedOffer] = useState(() => loadJSON(offerKey(token, mode, ref), null));
  const [offerCheck, setOfferCheck] = useState(null); // last authoritative /offers/check result
  const [customer, setCustomer] = useState(() => loadJSON(CUSTOMER_KEY, null));
  const [clientRef, setClientRef] = useState(() => localStorage.getItem(refKey(token, mode, ref)) || null);
  const [toast, setToast] = useState(null);
  const bootRef = useRef(false);
  const toastTimer = useRef(null);
  // Table QR seat reservation: one seat session per scan (see above); the
  // server claims the table atomically so two guests can never take the same
  // table, and an abandoned scan frees it after the claim TTL.
  const seatSessionId = useMemo(
    () => (mode === 'TABLE' ? loadSeatSessionId(token, mode, ref) : null),
    [token, mode, ref]
  );

  /** POST /table/claim — idempotent for this seat; extends on re-claim. */
  const doClaim = useCallback(
    async (tableId, tableNumber) => {
      if (!seatSessionId || !tableId) return { ok: false, message: '' };
      try {
        await api.post('/table/claim', {
          sessionId: seatSessionId,
          tableId,
          tableNumber: tableNumber || undefined,
        });
        return { ok: true, message: '' };
      } catch (err) {
        return { ok: false, message: errMsg(err, 'This table is currently in use') };
      }
    },
    [seatSessionId]
  );

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
        const qrData = {
          token,
          type: mode.toLowerCase(),
          tableId: mode === 'TABLE' ? ref || undefined : undefined,
          tableNumber: mode === 'TABLE' ? Number(tableNo) || undefined : undefined,
          parkingSlot: mode === 'CAR' ? ref || undefined : undefined,
          branchId: branchId || undefined,
          restaurant: data.store || {},
        };
        setQr(qrData);
        // Car mode needs driver details before ordering (drive-off prevention).
        setPhase(mode === 'CAR' && !loadJSON(CUSTOMER_KEY, null) ? 'need-car' : 'ready');
        // Reserve the scanned table ATOMICALLY — first scan wins, a table
        // with a live order is never handed out, and an abandoned scan frees
        // the table after the claim TTL. A 409 means the table is busy (a
        // waiter will seat you); the message is shown on the error screen.
        if (mode === 'TABLE' && qrData.tableId && seatSessionId) {
          const r = await doClaim(qrData.tableId, qrData.tableNumber);
          if (!r.ok) {
            setError(r.message);
            setTableBusy(true);
            setPhase('error');
            return;
          }
        }
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

  /* --------------------- seat heartbeat (table mode) --------------------- */
  // Extend the table reservation on REAL activity: cart edits (debounced) and
  // the tab becoming visible again. An abandoned scan stops heartbeating and
  // the server frees the table after the claim TTL, so a guest who never
  // orders can't block the table forever.
  useEffect(() => {
    if (mode !== 'TABLE' || phase !== 'ready' || !qr?.tableId || !seatSessionId) return;
    let cancelled = false;
    const beat = async () => {
      const r = await doClaim(qr.tableId, qr.tableNumber);
      if (!cancelled && !r.ok) {
        // Lost the table (e.g. our claim expired and another guest took it) —
        // surface it so the guest never orders onto another party's table.
        showToast('⚠️ This table is no longer reserved — please ask your server.');
      }
    };
    // Re-claim 8s after the guest stops changing the cart (debounce).
    const debounce = setTimeout(beat, 8000);
    const onVisibility = () => {
      if (!document.hidden) beat();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      clearTimeout(debounce);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [cart, mode, phase, qr, seatSessionId, doClaim, showToast]);

  /* --------------------------------- cart ops ---------------------------- */
  const addToCart = useCallback((line) => {
    setCart((prev) => {
      // Configured lines are distinct: same product + different selections are
      // two separate cart rows (never merged). Simple lines merge as before.
      const selKey = line.configuration
        ? JSON.stringify(line.configuration.selections || [])
        : '';
      const idx = prev.findIndex((l) => l.productId === line.productId && !l.configuration && !selKey);
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

  /* ------------------------------ offers --------------------------------- */
  const ensureOffers = useCallback(async () => {
    if (offers !== null) return offers;
    try {
      const { data } = await api.get('/offers', {
        params: branchId ? { branchId } : undefined,
      });
      setOffers(Array.isArray(data?.offers) ? data.offers : []);
      setOffersError('');
      return data?.offers || [];
    } catch (err) {
      setOffers([]);
      setOffersError(errMsg(err, 'Offers unavailable right now'));
      return [];
    }
  }, [offers, branchId]);

  /** Phase C — published promotion creatives (safe presentation fields). */
  const ensurePromotions = useCallback(async () => {
    if (promotions !== null) return promotions;
    try {
      const { data } = await api.get('/promotions', {
        params: branchId ? { branchId } : undefined,
      });
      setPromotions(Array.isArray(data?.promotions) ? data.promotions : []);
      return data?.promotions || [];
    } catch {
      setPromotions([]);
      return [];
    }
  }, [promotions, branchId]);

  /**
   * Phase B — one-tap apply: the server derives the subtotal from the cart
   * itself, validates eligibility and returns the AUTHORITATIVE discount.
   * The client never sends or trusts a subtotal/discount of its own.
   */
  const checkOfferOnServer = useCallback(
    async (offer) => {
      const body = {
        items: cart.map((l) => ({
          productId: l.productId,
          quantity: l.qty,
          ...(l.configuration ? { configuration: l.configuration } : {}),
        })),
        branchId: branchId || qr?.branchId || undefined,
        ...(offer?.id ? { offerId: offer.id } : {}),
        ...(offer?.couponCode ? { couponCode: offer.couponCode } : {}),
        customerPhone: customer?.phone || undefined,
      };
      const { data } = await api.post('/offers/check', body);
      return data;
    },
    [cart, branchId, qr, customer]
  );

  /** Apply an offer — persists it and stores the server's authoritative result. */
  const applyOffer = useCallback(
    async (offer) => {
      const result = await checkOfferOnServer(offer);
      if (!result.ok) {
        setOfferCheck(result);
        return result;
      }
      const applied = {
        id: offer?.id || result?.offer?.id,
        title: offer?.title || result?.offer?.title,
        couponCode: offer?.couponCode || result?.offer?.couponCode,
        type: offer?.type || result?.offer?.type,
        discount: Number(result.discount) || 0,
        afterDiscount: Number(result.afterDiscount) || 0,
        grandTotal: Number(result.grandTotal) || 0,
      };
      setAppliedOffer(applied);
      localStorage.setItem(offerKey(token, mode, ref), JSON.stringify(applied));
      setOfferCheck(result);
      return result;
    },
    [checkOfferOnServer, token, mode, ref]
  );

  /**
   * Re-validate the applied offer after the cart changes (item removed, qty
   * changed, offer expired…). If the server says it's no longer valid, remove
   * it gracefully so the cart never shows a stale discount.
   */
  const revalidateOffer = useCallback(async () => {
    if (!appliedOffer) return;
    try {
      const result = await checkOfferOnServer(appliedOffer);
      setOfferCheck(result);
      if (!result.ok || !result.valid) {
        setAppliedOffer(null);
        localStorage.removeItem(offerKey(token, mode, ref));
      }
    } catch {
      // Network hiccup — keep the applied offer; the order itself re-validates.
    }
  }, [appliedOffer, checkOfferOnServer, token, mode, ref]);

  /** Remove the applied offer (user action or after re-validation fails). */
  const removeOffer = useCallback(() => {
    setAppliedOffer(null);
    setOfferCheck(null);
    localStorage.removeItem(offerKey(token, mode, ref));
  }, [token, mode, ref]);

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
        items: cart.map((l) => ({
          productId: l.productId,
          quantity: l.qty,
          ...(l.configuration ? { configuration: l.configuration } : {}),
        })),
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
        // The server re-checks our seat claim atomically at order time so two
        // guests can never both land an order on the same table.
        seatSessionId: mode === 'TABLE' ? seatSessionId || undefined : undefined,
        // Phase B — the applied offer is validated server-side against the
        // order's own line items; the backend is the discount authority.
        ...(appliedOffer?.id ? { offerId: appliedOffer.id } : {}),
        ...(appliedOffer?.couponCode ? { couponCode: appliedOffer.couponCode } : {}),
      };

      const { data } = await api.post('/orders', body);
      localStorage.setItem(refKey(token, mode, ref), clientRefValue);
      setClientRef(clientRefValue);
      setCart([]);
      return { order: data.order, clientRef: clientRefValue };
    },
    [cart, customer, mode, qr, ref, token, branchId, appliedOffer, seatSessionId]
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
        // Branch isolation: the QR URL's `b=` param (baked by QR Studio) is
        // sent along so a multi-branch POS bell only sees calls for its own
        // location — never another branch's or restaurant's calls.
        branchId: branchId || qr?.branchId || undefined,
        tableId: mode === 'TABLE' ? qr?.tableId || undefined : undefined,
        parkingSlot: mode === 'CAR' ? qr?.parkingSlot || customer?.parkingSlot || undefined : undefined,
        carPlate: mode === 'CAR' ? customer?.carNumber || undefined : undefined,
        name: customer?.name,
        phone: customer?.phone,
        type,
        message: message || undefined,
      });
    },
    [customer, mode, qr, branchId]
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
      offers,
      offersError,
      ensureOffers,
      ensurePromotions,
      promotions,
      appliedOffer,
      offerCheck,
      applyOffer,
      revalidateOffer,
      removeOffer,
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
      menuCache, ensureMenu, offers, offersError, ensureOffers,
      promotions, ensurePromotions,
      appliedOffer, offerCheck, applyOffer, revalidateOffer, removeOffer,
      showToast, customer, submitCar, placeOrder, trackOrder, waiterCall,
      clientRef,
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
            {tableBusy ? (
              <>
                <p style={{ margin: '0 0 6px' }}>🪑 This table is currently in use.</p>
                <p className="muted" style={{ margin: 0 }}>
                  {error}
                </p>
              </>
            ) : (
              <>
                <p style={{ margin: '0 0 6px' }}>😵 Oops — this QR didn’t work.</p>
                <p className="muted" style={{ margin: 0 }}>
                  {error}
                </p>
              </>
            )}
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
