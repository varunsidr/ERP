import { prisma } from '../../lib/prisma';
import { badRequest, notFound } from '../../lib/errors';
import { reserveStock, releaseStock } from '../inventory/inventory.service';
import type { CreateOrderInput } from './orders.types';
import { recordAuditEvent } from '../audit/audit.service';
import { withFulfillment } from './order.rules';

const orderInclude = {
  items: { include: { product: true } },
  customer: true,
  invoice: true,
  shipments: { orderBy: { dispatchedAt: 'asc' as const }, include: { items: true } },
} as const;

export const listOrders = async () => {
  const orders = await prisma.order.findMany({
    include: orderInclude,
    orderBy: { createdAt: 'desc' },
  });
  return orders.map(withFulfillment);
};

export const getOrder = async (id: string) => {
  const order = await prisma.order.findUnique({ where: { id }, include: orderInclude });
  if (!order) {
    throw notFound(`Order ${id} not found`);
  }
  return withFulfillment(order);
};

// Order is created as DRAFT with a price snapshot per item (protects historical
// totals from later product price changes) but does not touch inventory yet.
export const createOrder = async (input: CreateOrderInput, actorId: string) => {
  const customer = await prisma.customer.findUnique({ where: { id: input.customerId } });
  if (!customer) {
    throw notFound(`Customer ${input.customerId} not found`);
  }

  const productIds = input.items.map((item) => item.productId);
  if (productIds.length !== new Set(productIds).size) {
    throw badRequest('An order cannot contain duplicate product lines');
  }
  const products = await prisma.product.findMany({ where: { id: { in: productIds } } });
  if (products.length !== productIds.length) {
    throw badRequest('One or more products do not exist');
  }
  const priceByProductId = new Map(products.map((product) => [product.id, product.priceCents]));

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        customerId: input.customerId,
        items: {
          create: input.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPriceCents: priceByProductId.get(item.productId)!,
          })),
        },
      },
      include: orderInclude,
    });
    await recordAuditEvent(tx, { actorId, action: 'order.created', entityType: 'Order', entityId: order.id,
      summary: `Created sales order for ${order.customer.name}` });
    return withFulfillment(order);
  });
};

// Confirming reserves stock for every line item atomically: either all items reserve
// successfully or the whole confirmation is rolled back (no partial reservation).
export const confirmOrder = async (id: string, actorId: string) => {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Order" WHERE "id" = ${id} FOR UPDATE
    `;
    if (!locked.length) throw notFound(`Order ${id} not found`);
    const order = await tx.order.findUnique({ where: { id }, include: orderInclude });
    if (!order) throw notFound(`Order ${id} not found`);
    if (order.status !== 'DRAFT') {
      throw badRequest(`Only DRAFT orders can be confirmed (current status: ${order.status})`);
    }
    for (const item of order.items) {
      await reserveStock(tx, item.productId, item.quantity, order.id);
    }
    const confirmed = await tx.order.update({
      where: { id },
      data: { status: 'CONFIRMED', confirmedAt: new Date() },
      include: orderInclude,
    });
    await recordAuditEvent(tx, { actorId, action: 'order.confirmed', entityType: 'Order', entityId: id,
      summary: `Confirmed sales order and reserved stock for ${order.customer.name}` });
    return withFulfillment(confirmed);
  });
};

// Cancelling a CONFIRMED order releases every reservation it holds; DRAFT orders have
// no reservations yet so cancellation is a plain status change.
export const cancelOrder = async (id: string, actorId: string) => {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Order" WHERE "id" = ${id} FOR UPDATE
    `;
    if (!locked.length) throw notFound(`Order ${id} not found`);
    const order = await tx.order.findUnique({ where: { id }, include: orderInclude });
    if (!order) throw notFound(`Order ${id} not found`);
    if (order.status === 'CANCELLED') throw badRequest('Order is already cancelled');
    if (order.invoice) throw badRequest('An invoiced order cannot be cancelled');
    if (order.shipments.length) throw badRequest('An order cannot be cancelled after any items have shipped');
    if (order.status === 'CONFIRMED') {
      for (const item of order.items) {
        await releaseStock(tx, item.productId, item.quantity, order.id);
      }
    }
    const cancelled = await tx.order.update({ where: { id }, data: { status: 'CANCELLED' }, include: orderInclude });
    await recordAuditEvent(tx, { actorId, action: 'order.cancelled', entityType: 'Order', entityId: id,
      summary: `Cancelled sales order for ${order.customer.name}` });
    return withFulfillment(cancelled);
  });
};
