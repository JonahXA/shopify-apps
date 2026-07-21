import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

/**
 * GDPR data request. Reconcile stores no customer PII (only order names,
 * amounts, and tax jurisdictions) so there is nothing customer-scoped to
 * export; acknowledging is compliant.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.webhook(request);
  return new Response();
};
