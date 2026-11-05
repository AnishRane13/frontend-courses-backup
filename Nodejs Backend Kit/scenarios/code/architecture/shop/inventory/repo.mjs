// Private to the inventory module: only inventory/index.mjs may import this file.
const stock = new Map([['sku-1', 5], ['sku-2', 0]]);   // stands in for the inventory module's own table
export const getStock = (sku) => stock.get(sku) ?? 0;
export const setStock = (sku, qty) => { stock.set(sku, qty); };
