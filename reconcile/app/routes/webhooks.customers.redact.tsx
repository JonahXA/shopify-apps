import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

/** GDPR customer redact: no customer PII stored — acknowledge. */
export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.webhook(request);
  return new Response();
};
