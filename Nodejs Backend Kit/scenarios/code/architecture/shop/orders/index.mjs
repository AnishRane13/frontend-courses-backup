// The orders module's public API. It reaches inventory only through inventory's index.
import * as inventory from '../inventory/index.mjs';
import { saveOrder, countOrders } from './repo.mjs';

export function placeOrder({ sku, qty }) {
  const r = inventory.reserve(sku, qty);
  if (!r.ok) return { ok: false, reason: r.reason };
  return { ok: true, order: saveOrder({ sku, qty }) };
}
export const orderCount = () => countOrders();
