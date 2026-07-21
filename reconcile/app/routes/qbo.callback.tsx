import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { exchangeCode } from "../qbo/oauth";
import { qboConfig, saveTokens, verifyState } from "../qbo/connection.server";

/**
 * Intuit redirects here after the merchant approves access.
 * Public route (outside the embedded admin); shop identity comes from the
 * HMAC-signed state we issued in app.qbo.connect.
 *
 * Returns a small self-closing page rather than throwing, so failures are
 * legible during setup instead of a blank 500.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const realmId = url.searchParams.get("realmId");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error === "access_denied") {
    return { status: "declined" as const };
  }
  if (!code || !realmId || !state) {
    return { status: "missing" as const };
  }

  let shop: string;
  try {
    shop = verifyState(state);
  } catch {
    return { status: "bad_state" as const };
  }

  try {
    const tokens = await exchangeCode(qboConfig(), code, realmId);
    await saveTokens(shop, tokens);
  } catch (e) {
    return {
      status: "exchange_failed" as const,
      detail: e instanceof Error ? e.message : String(e),
    };
  }

  // Success: bounce back into the embedded app in the store admin.
  throw redirect(`https://${shop}/admin/apps`);
};

export default function QboCallback() {
  const data = useLoaderData<typeof loader>();
  const messages: Record<string, string> = {
    declined: "QuickBooks access was cancelled. You can close this tab and try again from the app.",
    missing: "This page is the QuickBooks connection callback. Start the connection from inside the Reconcile app.",
    bad_state: "The connection link expired or was invalid. Please retry connecting from the app.",
    exchange_failed: "Couldn't complete the QuickBooks connection.",
  };
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 480, margin: "80px auto", padding: 24 }}>
      <h1 style={{ fontSize: 20 }}>Reconcile — QuickBooks</h1>
      <p>{messages[data.status] ?? "Unexpected state."}</p>
      {"detail" in data && data.detail ? (
        <pre style={{ background: "#f6f6f6", padding: 12, borderRadius: 8, whiteSpace: "pre-wrap", fontSize: 12 }}>
          {data.detail}
        </pre>
      ) : null}
    </main>
  );
}
