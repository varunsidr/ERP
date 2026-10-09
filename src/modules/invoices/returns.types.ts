import { z } from 'zod';

export const createReturnSchema = z.object({
  reason: z.string().trim().min(3).max(160),
  items: z.array(z.object({
    invoiceItemId: z.string().min(1),
    quantity: z.number().int().positive(),
    resaleable: z.boolean(),
  })).min(1).max(50).refine(
    items => items.length === new Set(items.map(item => item.invoiceItemId)).size,
    'A return cannot contain the same invoice line twice',
  ),
});

export const returnIdempotencyKeySchema = z.string().trim().min(8).max(128);

export type CreateReturnInput = z.infer<typeof createReturnSchema>;
