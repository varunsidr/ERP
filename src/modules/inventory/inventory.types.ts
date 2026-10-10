import { z } from 'zod';

export const addStockSchema = z.object({
  quantity: z.number().int().positive(),
  note: z.string().trim().max(160).optional(),
});

export const adjustStockSchema = z.object({
  quantityDelta: z.number().int().min(-2_147_483_647).max(2_147_483_647).refine((value) => value !== 0, 'Enter a non-zero adjustment'),
  reason: z.string().trim().min(3).max(160),
});

export const stockIdempotencyKeySchema = z.string().min(8).max(200).regex(/^[A-Za-z0-9._~-]+$/);

export type AddStockInput = z.infer<typeof addStockSchema>;
export type AdjustStockInput = z.infer<typeof adjustStockSchema>;

export type InventoryMovementType =
  | 'MANUAL_ADDITION'
  | 'STOCK_ADJUSTMENT'
  | 'PURCHASE_RECEIPT'
  | 'ORDER_RESERVATION'
  | 'ORDER_RELEASE'
  | 'SALE_CONSUMPTION'
  | 'RETURN_RESTOCK';

export interface InventoryMovementContext {
  type: InventoryMovementType;
  referenceType?: 'ORDER' | 'SHIPMENT' | 'PURCHASE_ORDER' | 'MANUAL' | 'RETURN';
  referenceId?: string;
  note?: string;
  idempotencyKeyHash?: string;
}
