import type { Prisma, PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { prisma } from '../../lib/prisma';
import { badRequest, conflict, notFound } from '../../lib/errors';
import type { InventoryMovementContext } from './inventory.types';
import { recordAuditEvent } from '../audit/audit.service';

type Client = PrismaClient | Prisma.TransactionClient;

const lockInventoryItem = async (client: Client, productId: string) => {
  const locked = await client.$queryRaw<Array<{ productId: string }>>`
    SELECT "productId" FROM "InventoryItem" WHERE "productId" = ${productId} FOR UPDATE
  `;
  if (!locked.length) throw notFound(`No inventory record for product ${productId}`);
  return getInventoryForProduct(productId, client);
};

export const getInventoryForProduct = async (productId: string, client: Client = prisma) => {
  const item = await client.inventoryItem.findUnique({ where: { productId } });
  if (!item) {
    throw notFound(`No inventory record for product ${productId}`);
  }
  return item;
};

export const listInventoryMovements = (productId: string) =>
  prisma.inventoryMovement.findMany({
    where: { productId },
    select: { id: true, productId: true, type: true, quantityDelta: true, reservedDelta: true, referenceType: true, referenceId: true, note: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

const recordMovement = (
  client: Client,
  productId: string,
  quantityDelta: number,
  reservedDelta: number,
  context: InventoryMovementContext,
) =>
  client.inventoryMovement.create({
    data: {
      productId,
      quantityDelta,
      reservedDelta,
      type: context.type,
      referenceType: context.referenceType,
      referenceId: context.referenceId,
      note: context.note,
      idempotencyKeyHash: context.idempotencyKeyHash,
    },
  });

export const increaseStock = async (
  client: Client,
  productId: string,
  quantity: number,
  context: InventoryMovementContext,
) => {
  await lockInventoryItem(client, productId);
  const updated = await client.inventoryItem.update({
    where: { productId },
    data: { availableQty: { increment: quantity } },
  });
  await recordMovement(client, productId, quantity, 0, context);
  return updated;
};

export const addStock = async (productId: string, quantity: number, actorId: string, note?: string, idempotencyKey?: string) => {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw badRequest('Stock quantity must be a positive integer');
  }
  const idempotencyKeyHash = idempotencyKey ? createHash('sha256').update(idempotencyKey).digest('hex') : undefined;
  return prisma.$transaction(async (tx) => {
    if (idempotencyKeyHash) {
      // The lock function returns PostgreSQL's `void`, which Prisma cannot decode
      // from a raw result. IS NULL returns a plain boolean after taking the lock.
      await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_advisory_xact_lock(hashtextextended(${idempotencyKeyHash}, 0)) IS NULL AS locked`;
      const prior = await tx.inventoryMovement.findUnique({ where: { idempotencyKeyHash } });
      if (prior) {
        if (prior.productId !== productId || prior.type !== 'MANUAL_ADDITION' || prior.quantityDelta !== quantity || prior.note !== (note || null)) {
          throw conflict('Idempotency key was already used for a different stock adjustment');
        }
        return getInventoryForProduct(productId, tx);
      }
    }
    const updated = await increaseStock(tx, productId, quantity, {
      type: 'MANUAL_ADDITION',
      referenceType: 'MANUAL',
      note,
      idempotencyKeyHash,
    });
    await recordAuditEvent(tx, { actorId, action: 'stock.added', entityType: 'Product', entityId: productId,
      summary: `Added ${quantity} units to stock${note ? `: ${note}` : ''}` });
    return updated;
  });
};

// A count correction changes physical on-hand stock but never rewrites existing
// reservations. A negative correction cannot reduce on-hand below reserved stock.
export const adjustStock = async (productId: string, quantityDelta: number, reason: string, actorId: string, idempotencyKey: string) => {
  if (!Number.isInteger(quantityDelta) || quantityDelta === 0) {
    throw badRequest('Stock adjustment must be a non-zero whole number');
  }
  const idempotencyKeyHash = createHash('sha256').update(idempotencyKey).digest('hex');
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_advisory_xact_lock(hashtextextended(${idempotencyKeyHash}, 0)) IS NULL AS locked`;
    const prior = await tx.inventoryMovement.findUnique({ where: { idempotencyKeyHash } });
    if (prior) {
      if (prior.productId !== productId || prior.type !== 'STOCK_ADJUSTMENT' || prior.quantityDelta !== quantityDelta || prior.note !== reason) {
        throw conflict('Idempotency key was already used for a different stock adjustment');
      }
      return getInventoryForProduct(productId, tx);
    }

    const inventory = await lockInventoryItem(tx, productId);
    const nextAvailable = inventory.availableQty + quantityDelta;
    if (nextAvailable < inventory.reservedQty) {
      throw badRequest(`Adjustment would leave ${nextAvailable} units on hand, below ${inventory.reservedQty} reserved units`);
    }
    const updated = await tx.inventoryItem.update({
      where: { productId },
      data: { availableQty: { increment: quantityDelta } },
    });
    await recordMovement(tx, productId, quantityDelta, 0, {
      type: 'STOCK_ADJUSTMENT', referenceType: 'MANUAL', note: reason, idempotencyKeyHash,
    });
    await recordAuditEvent(tx, { actorId, action: 'stock.adjusted', entityType: 'Product', entityId: productId,
      summary: `Adjusted on-hand stock by ${quantityDelta > 0 ? '+' : ''}${quantityDelta}: ${reason}` });
    return updated;
  });
};

// Reserves `quantity` units for a product. Must run inside the same transaction that
// creates/confirms the order so reservation is atomic with the order state change.
export const reserveStock = async (client: Client, productId: string, quantity: number, orderId?: string) => {
  const item = await lockInventoryItem(client, productId);
  const unreserved = item.availableQty - item.reservedQty;
  if (unreserved < quantity) {
    throw badRequest(`Insufficient stock for product ${productId}: requested ${quantity}, available ${unreserved}`);
  }

  const updated = await client.inventoryItem.update({
    where: { productId },
    data: { reservedQty: { increment: quantity } },
  });
  await recordMovement(client, productId, 0, quantity, {
    type: 'ORDER_RESERVATION',
    referenceType: 'ORDER',
    referenceId: orderId,
  });
  return updated;
};

// Releases previously reserved quantity (e.g. when an order is cancelled).
export const releaseStock = async (client: Client, productId: string, quantity: number, orderId?: string) => {
  const item = await lockInventoryItem(client, productId);
  if (item.reservedQty < quantity) {
    throw badRequest(`Cannot release ${quantity} reserved units for product ${productId}`);
  }
  const updated = await client.inventoryItem.update({
    where: { productId },
    data: { reservedQty: { decrement: quantity } },
  });
  await recordMovement(client, productId, 0, -quantity, {
    type: 'ORDER_RELEASE',
    referenceType: 'ORDER',
    referenceId: orderId,
  });
  return updated;
};

// Consumes reserved quantity out of on-hand stock when a shipment is dispatched.
export const consumeReservedStock = async (client: Client, productId: string, quantity: number, shipmentId: string) => {
  const item = await lockInventoryItem(client, productId);
  if (item.reservedQty < quantity || item.availableQty < quantity) {
    throw badRequest(`Cannot consume ${quantity} reserved units for product ${productId}`);
  }
  const updated = await client.inventoryItem.update({
    where: { productId },
    data: {
      reservedQty: { decrement: quantity },
      availableQty: { decrement: quantity },
    },
  });
  await recordMovement(client, productId, -quantity, -quantity, {
    type: 'SALE_CONSUMPTION',
    referenceType: 'SHIPMENT',
    referenceId: shipmentId,
  });
  return updated;
};
