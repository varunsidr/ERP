export type OrderFulfillmentStatus =
  | 'DRAFT'
  | 'READY_TO_SHIP'
  | 'PARTIALLY_SHIPPED'
  | 'READY_TO_INVOICE'
  | 'INVOICED'
  | 'CANCELLED';

type ShipmentLine = { orderItemId: string; quantity: number };
type FulfillmentOrder = {
  status: string;
  invoice: unknown | null;
  items: { id: string; quantity: number }[];
  shipments: { items: ShipmentLine[] }[];
};

export const shippedQuantitiesByOrderItem = (order: Pick<FulfillmentOrder, 'shipments'>) => {
  const shipped = new Map<string, number>();
  for (const shipment of order.shipments) {
    for (const item of shipment.items) {
      shipped.set(item.orderItemId, (shipped.get(item.orderItemId) ?? 0) + item.quantity);
    }
  }
  return shipped;
};

export const orderFulfillmentStatus = (order: FulfillmentOrder): OrderFulfillmentStatus => {
  if (order.status === 'CANCELLED') return 'CANCELLED';
  if (order.invoice) return 'INVOICED';
  if (order.status === 'DRAFT') return 'DRAFT';
  if (order.status !== 'CONFIRMED') throw new Error(`Unexpected sales order status: ${order.status}`);

  const shipped = shippedQuantitiesByOrderItem(order);
  const shippedUnits = order.items.reduce((sum, item) => sum + (shipped.get(item.id) ?? 0), 0);
  if (shippedUnits === 0) return 'READY_TO_SHIP';
  const orderedUnits = order.items.reduce((sum, item) => sum + item.quantity, 0);
  if (shippedUnits > orderedUnits) throw new Error('Shipped quantities exceed the sales order quantities');
  return shippedUnits === orderedUnits ? 'READY_TO_INVOICE' : 'PARTIALLY_SHIPPED';
};

export const withFulfillment = <T extends FulfillmentOrder>(order: T) => {
  const shipped = shippedQuantitiesByOrderItem(order);
  return {
    ...order,
    fulfillmentStatus: orderFulfillmentStatus(order),
    shippedQuantities: Object.fromEntries(order.items.map(item => [item.id, shipped.get(item.id) ?? 0])),
    remainingQuantities: Object.fromEntries(order.items.map(item => [item.id, item.quantity - (shipped.get(item.id) ?? 0)])),
  };
};
