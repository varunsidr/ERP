import { z } from 'zod';

export const createShipmentSchema = z.object({
  items: z.array(z.object({
    orderItemId: z.string().min(1),
    quantity: z.number().int().positive(),
  })).min(1).max(50).refine(
    items => items.length === new Set(items.map(item => item.orderItemId)).size,
    'A shipment cannot contain the same sales order line twice',
  ),
});

export const shipmentIdempotencyKeySchema = z.string().trim().min(1).max(128);

export type CreateShipmentInput = z.infer<typeof createShipmentSchema>;
