import { createContext, useContext } from 'react';

export const SessionContext = createContext(null);

export const useSession = () => useContext(SessionContext);

/** Price of one cart line: unit price × quantity (flat lines, no variants). */
export function linePrice(line) {
  return (Number(line.price) || 0) * line.qty;
}

export function cartSubtotal(cart) {
  return cart.reduce((s, l) => s + linePrice(l), 0);
}
