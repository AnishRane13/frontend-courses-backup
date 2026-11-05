// Fixture for verify-ar1.mjs: never run, only scanned. It skips inventory's API and writes stock directly.
import { setStock } from '../inventory/repo.mjs';
export const placeOrder = () => setStock('sku-1', 0);
