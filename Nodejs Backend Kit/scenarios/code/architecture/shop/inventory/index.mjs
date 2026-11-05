// The inventory module's public API. Other modules call these functions, never the repo.
import { getStock, setStock } from './repo.mjs';

export function reserve(sku, qty) {
  const left = getStock(sku);
  if (qty > left) return { ok: false, reason: 'out of stock' };
  setStock(sku, left - qty);
  return { ok: true };
}
export const stockOf = (sku) => getStock(sku);
