// Private to the orders module.
const orders = [];                                    // stands in for the orders module's own table
export const saveOrder = (o) => { orders.push(o); return { id: orders.length, ...o }; };
export const countOrders = () => orders.length;
