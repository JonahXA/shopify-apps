import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { normalizeOrder, type OrderWebhookPayload } from "../ingest/normalize";

/** orders/create + orders/updated: upsert the normalized order record. */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  const row = normalizeOrder(payload as unknown as OrderWebhookPayload);
  await prisma.shopOrder.upsert({
    where: { id: row.id },
    create: { ...row, shop },
    update: { ...row, shop },
  });
  return new Response();
};
