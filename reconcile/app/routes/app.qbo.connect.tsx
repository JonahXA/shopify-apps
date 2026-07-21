import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { authorizeUrl } from "../qbo/oauth";
import { makeState, qboConfig } from "../qbo/connection.server";

/** Kicks off the QuickBooks OAuth flow for the current shop. */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const cfg = qboConfig();
  return redirect(authorizeUrl(cfg, makeState(session.shop)), {
    // break out of the embedded-admin iframe for Intuit's login page
    headers: { "X-Frame-Options": "DENY" },
  });
};
