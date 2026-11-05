// AR1: a modular monolith. Each module exposes a small API and keeps its data private.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { findViolations } from './boundaries.mjs';
import { placeOrder, orderCount } from './shop/orders/index.mjs';
import { stockOf } from './shop/inventory/index.mjs';

const here = import.meta.dirname;

// 1. The real modules respect the boundary: orders reaches inventory only through its index.
assert.deepEqual(findViolations(join(here, 'shop')), []);

// 2. The check is not a rubber stamp: a direct import of another module's repo is caught.
assert.deepEqual(findViolations(join(here, 'bad-shop')), ['orders/index.mjs -> inventory/repo.mjs']);

// 3. The behaviour still works across the boundary.
assert.deepEqual(placeOrder({ sku: 'sku-1', qty: 2 }), { ok: true, order: { id: 1, sku: 'sku-1', qty: 2 } });
assert.equal(stockOf('sku-1'), 3);
assert.deepEqual(placeOrder({ sku: 'sku-1', qty: 4 }), { ok: false, reason: 'out of stock' });
assert.equal(stockOf('sku-1'), 3);
assert.equal(orderCount(), 1);

console.log('verify-ar1: all assertions passed');
