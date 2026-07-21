import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { normalizeRefund, type RefundWebhookPayload } from "../ingest/normalize";

/** refunds/create: normalize against the stored order's currency/tax lines. */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  const p = payload as unknown as RefundWebhookPayload;
  const order = await prisma.shopOrder.findUnique({ where: { id: String(p.order_id) } });
  // If the order predates install/backfill we can't attribute the refund yet;
  // the sweep will heal it once the order is backfilled.
  if (!order) return new Response();
  const titles = (JSON.parse(order.taxJson) as Array<{ title: string }>).map((t) => t.title);
  const row = normalizeRefund(p, order.currency, titles);
  await prisma.shopRefund.upsert({
    where: { id: row.id },
    create: { ...row, shop },
    update: { ...row, shop },
  });
  return new Response();
};
