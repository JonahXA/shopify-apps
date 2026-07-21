import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

/** GDPR shop redact (48h after uninstall): purge everything for the shop. */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await authenticate.webhook(request);
  await prisma.$transaction([
    prisma.qboPosting.deleteMany({ where: { shop } }),
    prisma.balanceTxn.deleteMany({ where: { shop } }),
    prisma.payout.deleteMany({ where: { shop } }),
    prisma.shopRefund.deleteMany({ where: { shop } }),
    prisma.shopOrder.deleteMany({ where: { shop } }),
    prisma.accountMap.deleteMany({ where: { shop } }),
    prisma.qboConnection.deleteMany({ where: { shop } }),
  ]);
  return new Response();
};
