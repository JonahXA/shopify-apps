import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { backfillOrders, sweepPayouts } from "../ingest/sweep.server";
import { postEligiblePayouts } from "../ingest/post.server";

/**
 * External-cron entry point (payouts have no webhook): sweeps every
 * installed shop, then posts eligible payouts. Protected by JOBS_TOKEN.
 * Hit hourly from the host's scheduler.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const token = request.headers.get("x-jobs-token");
  if (!process.env.JOBS_TOKEN || token !== process.env.JOBS_TOKEN) {
    throw new Response("Unauthorized", { status: 401 });
  }
  const shops = await prisma.session.findMany({
    distinct: ["shop"],
    select: { shop: true },
  });
  const report: Record<string, unknown> = {};
  for (const { shop } of shops) {
    try {
      const { admin } = await unauthenticated.admin(shop);
      const swept = await sweepPayouts(admin.graphql, shop);
      const orders = await backfillOrders(admin.graphql, shop);
      const posted = await postEligiblePayouts(shop);
      report[shop] = { ...swept, orders, posted: posted.length };
    } catch (e) {
      report[shop] = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  return json(report);
};
