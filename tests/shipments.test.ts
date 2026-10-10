import assert from 'node:assert/strict';
import test from 'node:test';
import ejs from 'ejs';
import path from 'node:path';
import { prisma } from '../src/lib/prisma';
import { can } from '../src/lib/permissions';
import { createInvoice } from '../src/modules/invoices/invoices.service';
import { orderFulfillmentStatus } from '../src/modules/orders/order.rules';
import { cancelOrder } from '../src/modules/orders/orders.service';
import { createShipment } from '../src/modules/orders/shipments.service';
import { createShipmentSchema, shipmentIdempotencyKeySchema } from '../src/modules/orders/shipments.types';

test('shipment inputs require distinct positive quantities and a retry key', () => {
  const valid = { items: [{ orderItemId: 'line-1', quantity: 2 }] };
  assert.equal(createShipmentSchema.safeParse(valid).success, true);
  assert.equal(createShipmentSchema.safeParse({ items: [] }).success, false);
  assert.equal(createShipmentSchema.safeParse({ items: [{ orderItemId: 'line-1', quantity: 0 }] }).success, false);
  assert.equal(createShipmentSchema.safeParse({ items: [valid.items[0], valid.items[0]] }).success, false);
  assert.equal(shipmentIdempotencyKeySchema.safeParse('dispatch-0001').success, true);
  assert.equal(shipmentIdempotencyKeySchema.safeParse('').success, false);
});

test('shipment dispatch is restricted to Inventory and Admin', () => {
  assert.equal(can('INVENTORY', 'shipments.write'), true);
  assert.equal(can('ADMIN', 'shipments.write'), true);
  assert.equal(can('SALES', 'shipments.write'), false);
  assert.equal(can('STAFF', 'shipments.write'), false);
});

test('partial shipment retries consume reserved stock once and invoices wait for complete shipment', async t => {
  const delegates = [
    [prisma as any, '$transaction'],
    [prisma as any, '$queryRaw'],
    [prisma.order as any, 'findUnique'],
    [prisma.order as any, 'update'],
    [prisma.shipment as any, 'findUnique'],
    [prisma.shipment as any, 'create'],
    [prisma.invoice as any, 'create'],
    [prisma.inventoryItem as any, 'findUnique'],
    [prisma.inventoryItem as any, 'update'],
    [prisma.inventoryMovement as any, 'create'],
    [prisma.auditEvent as any, 'create'],
  ] as const;
  const descriptors = delegates.map(([target, name]) => [target, name, Object.getOwnPropertyDescriptor(target, name)] as const);
  t.after(() => {
    for (const [target, name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(target, name, descriptor);
      else delete target[name];
    }
  });

  const order: any = {
    id: 'order-1',
    status: 'CONFIRMED',
    invoice: null,
    items: [{
      id: 'line-1',
      orderId: 'order-1',
      productId: 'product-1',
      quantity: 10,
      unitPriceCents: 500,
      product: { id: 'product-1', name: 'Widget', sku: 'WIDGET-001' },
    }],
    shipments: [],
  };
  const shipmentByKey = new Map<string, any>();
  const movements: any[] = [];
  const audits: any[] = [];
  let shipmentCount = 0;
  let availableQty = 20;
  let reservedQty = 10;

  (prisma as any).$transaction = async (callback: (tx: any) => unknown) => callback(prisma as any);
  (prisma as any).$queryRaw = async (parts: TemplateStringsArray) => {
    const query = parts.join('');
    return query.includes('FROM "Order"') ? [{ id: 'order-1' }] : [{ productId: 'product-1' }];
  };
  (prisma.order as any).findUnique = async () => structuredClone(order);
  (prisma.order as any).update = async () => { throw new Error('A dispatched order must not be cancelled'); };
  (prisma.shipment as any).findUnique = async ({ where }: any) =>
    shipmentByKey.get(`${where.orderId_idempotencyKey.orderId}:${where.orderId_idempotencyKey.idempotencyKey}`) ?? null;
  (prisma.shipment as any).create = async ({ data }: any) => {
    const shipment = {
      id: `shipment-${++shipmentCount}`,
      orderId: data.orderId,
      idempotencyKey: data.idempotencyKey,
      requestHash: data.requestHash,
      dispatchedAt: new Date(),
      items: data.items.create.map((item: any) => ({
        ...item,
        id: `shipment-line-${shipmentCount}`,
        orderItem: order.items.find((orderItem: any) => orderItem.id === item.orderItemId),
      })),
    };
    shipmentByKey.set(`${data.orderId}:${data.idempotencyKey}`, shipment);
    order.shipments.push({ items: data.items.create });
    return shipment;
  };
  (prisma.invoice as any).create = async ({ data }: any) => ({ id: 'invoice-1', ...data });
  (prisma.inventoryItem as any).findUnique = async () => ({ productId: 'product-1', availableQty, reservedQty });
  (prisma.inventoryItem as any).update = async ({ data }: any) => {
    availableQty -= data.availableQty?.decrement ?? 0;
    reservedQty -= data.reservedQty?.decrement ?? 0;
    return { productId: 'product-1', availableQty, reservedQty };
  };
  (prisma.inventoryMovement as any).create = async ({ data }: any) => {
    movements.push(data);
    return data;
  };
  (prisma.auditEvent as any).create = async ({ data }: any) => {
    audits.push(data);
    return data;
  };

  const firstInput = { items: [{ orderItemId: 'line-1', quantity: 4 }] };
  const first = await createShipment('order-1', 'dispatch-0001', firstInput, 'inventory-user');
  assert.equal(first.id, 'shipment-1');
  assert.equal(availableQty, 16);
  assert.equal(reservedQty, 6);
  assert.equal(movements.length, 1);
  assert.equal(movements[0].referenceType, 'SHIPMENT');
  assert.equal(movements[0].referenceId, 'shipment-1');
  await assert.rejects(createInvoice({ orderId: 'order-1' }, 'sales-user'), /Ship all ordered quantities/);
  await assert.rejects(cancelOrder('order-1', 'sales-user'), /cannot be cancelled after any items have shipped/);

  await createShipment('order-1', 'dispatch-0001', firstInput, 'inventory-user');
  assert.equal(shipmentCount, 1);
  assert.equal(availableQty, 16);
  assert.equal(reservedQty, 6);
  assert.equal(movements.length, 1);
  assert.equal(audits.length, 1);

  await assert.rejects(
    createShipment('order-1', 'dispatch-0001', { items: [{ orderItemId: 'line-1', quantity: 3 }] }, 'inventory-user'),
    /Idempotency key was already used for a different shipment/,
  );
  await assert.rejects(
    createShipment('order-1', 'dispatch-0002', { items: [{ orderItemId: 'line-1', quantity: 7 }] }, 'inventory-user'),
    /only 6 remain/,
  );
  assert.equal(shipmentCount, 1);
  assert.equal(movements.length, 1);

  await createShipment('order-1', 'dispatch-0002', { items: [{ orderItemId: 'line-1', quantity: 6 }] }, 'inventory-user');
  assert.equal(availableQty, 10);
  assert.equal(reservedQty, 0);
  assert.equal(orderFulfillmentStatus(order), 'READY_TO_INVOICE');
  assert.equal(movements.length, 2);

  const invoice = await createInvoice({ orderId: 'order-1' }, 'sales-user');
  assert.equal(invoice.id, 'invoice-1');
  assert.equal(movements.length, 2);
  assert.deepEqual(audits.map(audit => audit.action), [
    'order.shipment_dispatched',
    'order.shipment_dispatched',
    'invoice.issued',
  ]);
});

test('order fulfillment stages reflect cumulative shipped quantities', () => {
  const order: any = {
    invoice: null,
    items: [{ id: 'line-1', quantity: 5 }],
    shipments: [],
  };
  assert.equal(orderFulfillmentStatus({ ...order, status: 'DRAFT' }), 'DRAFT');
  assert.equal(orderFulfillmentStatus({ ...order, status: 'CONFIRMED' }), 'READY_TO_SHIP');
  assert.equal(orderFulfillmentStatus({
    ...order,
    status: 'CONFIRMED',
    shipments: [{ items: [{ orderItemId: 'line-1', quantity: 2 }] }],
  }), 'PARTIALLY_SHIPPED');
  assert.equal(orderFulfillmentStatus({
    ...order,
    status: 'CONFIRMED',
    shipments: [{ items: [{ orderItemId: 'line-1', quantity: 5 }] }],
  }), 'READY_TO_INVOICE');
  assert.equal(orderFulfillmentStatus({ ...order, status: 'CONFIRMED', invoice: { id: 'invoice-1' } }), 'INVOICED');
  assert.equal(orderFulfillmentStatus({ ...order, status: 'CANCELLED' }), 'CANCELLED');
});

test('partially shipped order view exposes dispatch, hides invoice, and blocks cancellation', async () => {
  const html = await ejs.renderFile(path.resolve('src/web/views/orders/show.ejs'), {
    pageTitle: 'Sales order',
    isAuthenticated: true,
    user: { name: 'Warehouse operator', role: 'INVENTORY' },
    can: (permission: string) => permission === 'shipments.write',
    csrfToken: 'csrf-token',
    shipmentIdempotencyKey: 'dispatch-0003',
    defaultInvoiceDueDate: '2026-11-09',
    order: {
      id: 'order-1',
      status: 'CONFIRMED',
      fulfillmentStatus: 'PARTIALLY_SHIPPED',
      customer: { id: 'customer-1', name: 'Northwind', email: 'buyer@example.test' },
      items: [{
        id: 'line-1',
        quantity: 10,
        unitPriceCents: 500,
        product: { id: 'product-1', name: 'Widget', sku: 'WIDGET-001' },
      }],
      shipments: [{
        id: 'shipment-1',
        dispatchedAt: new Date('2026-10-10T00:00:00.000Z'),
        items: [{ orderItemId: 'line-1', quantity: 4 }],
      }],
      invoice: null,
      shippedQuantities: { 'line-1': 4 },
      remainingQuantities: { 'line-1': 6 },
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
      confirmedAt: new Date('2026-10-02T00:00:00.000Z'),
    },
  });
  assert.match(html, /Dispatch selected quantities/);
  assert.match(html, /Ship Widget/);
  assert.match(html, /Shipped 4 \/ 10/);
  assert.doesNotMatch(html, /Issue invoice/);
  assert.doesNotMatch(html, /Cancel order/);
});
