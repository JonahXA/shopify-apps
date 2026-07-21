import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { exchangeCode } from "../qbo/oauth";
import { qboConfig, saveTokens, verifyState } from "../qbo/connection.server";

/**
 * Intuit redirects here after the merchant approves access.
 * Public route (outside the embedded admin); shop identity comes from the
 * HMAC-signed state we issued in app.qbo.connect.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const realmId = url.searchParams.get("realmId");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error === "access_denied") {
    // merchant declined — send them back to the app with a soft message
    return redirect("/app?qbo=declined");
  }
  if (!code || !realmId || !state) {
    throw new Response("Missing OAuth parameters", { status: 400 });
  }
  const shop = verifyState(state);
  const tokens = await exchangeCode(qboConfig(), code, realmId);
  await saveTokens(shop, tokens);

  // back into the embedded app (admin re-establishes the session)
  return redirect(`https://${shop}/admin/apps`);
};
