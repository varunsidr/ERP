import { createHash } from 'node:crypto';
import { prisma } from '../../lib/prisma';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { recordAuditEvent } from '../audit/audit.service';
import { consumeReservedStock } from '../inventory/inventory.service';
import { shippedQuantitiesByOrderItem } from './order.rules';
import type { CreateShipmentInput } from './shipments.types';

const shipmentInclude = {
  items: { include: { orderItem: { include: { product: true } } } },
} as const;

const orderInclude = {
  items: { include: { product: true } },
  invoice: true,
  shipments: { include: { items: true } },
} as const;

export const createShipment = async (
  orderId: string,
  idempotencyKey: string,
  input: CreateShipmentInput,
  actorId: string,
) => prisma.$transaction(async tx => {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE
  `;
  if (!locked.length) throw notFound(`Order ${orderId} not found`);
  const order = await tx.order.findUnique({ where: { id: orderId }, include: orderInclude });
  if (!order) throw notFound(`Order ${orderId} not found`);

  const normalizedItems = [...input.items].sort((a, b) => a.orderItemId.localeCompare(b.orderItemId));
  const requestHash = createHash('sha256').update(JSON.stringify(normalizedItems)).digest('hex');
  const previous = await tx.shipment.findUnique({
    where: { orderId_idempotencyKey: { orderId, idempotencyKey } },
    include: shipmentInclude,
  });
  if (previous) {
    if (previous.requestHash !== requestHash) {
      throw conflict('Idempotency key was already used for a different shipment');
    }
    return previous;
  }
  if (order.invoice) throw badRequest('An invoiced order cannot be shipped again');
  if (order.status !== 'CONFIRMED') {
    throw badRequest(`Only CONFIRMED orders can be shipped (current status: ${order.status})`);
  }

  const orderItemById = new Map(order.items.map(item => [item.id, item]));
  const shippedByOrderItem = shippedQuantitiesByOrderItem(order);
  for (const line of normalizedItems) {
    const item = orderItemById.get(line.orderItemId);
    if (!item) throw badRequest('Shipment contains a line that does not belong to this sales order');
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw badRequest('Shipment quantities must be positive whole numbers');
    }
    const remaining = item.quantity - (shippedByOrderItem.get(item.id) ?? 0);
    if (line.quantity > remaining) {
      throw badRequest(`Cannot ship ${line.quantity} units; only ${remaining} remain for ${item.product.name}`);
    }
  }

  const shipment = await tx.shipment.create({
    data: {
      orderId,
      idempotencyKey,
      requestHash,
      items: { create: normalizedItems },
    },
    include: shipmentInclude,
  });
  for (const line of normalizedItems) {
    const orderItem = orderItemById.get(line.orderItemId)!;
    await consumeReservedStock(tx, orderItem.productId, line.quantity, shipment.id);
  }
  const units = normalizedItems.reduce((sum, line) => sum + line.quantity, 0);
  await recordAuditEvent(tx, {
    actorId,
    action: 'order.shipment_dispatched',
    entityType: 'Order',
    entityId: orderId,
    summary: `Dispatched ${units} units in shipment ${shipment.id.slice(0, 12)}`,
  });
  return shipment;
});
