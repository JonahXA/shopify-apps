/**
 * QBO connection lifecycle: config from env, HMAC-signed OAuth state,
 * token persistence, client construction.
 */
import crypto from "node:crypto";
import prisma from "../db.server";
import { QboClient } from "./client";
import type { QboOauthConfig, QboTokens } from "./oauth";

export function qboConfig(): QboOauthConfig & { env: "sandbox" | "production" } {
  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  const redirectUri = process.env.QBO_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    // Credential gate: needs Jonah's Intuit Developer app registration.
    throw new Error(
      "QBO_CLIENT_ID / QBO_CLIENT_SECRET / QBO_REDIRECT_URI are not set. " +
        "Register the app at developer.intuit.com and add them to .env.",
    );
  }
  return {
    clientId,
    clientSecret,
    redirectUri,
    env: process.env.QBO_ENV === "production" ? "production" : "sandbox",
  };
}

const stateSecret = () => process.env.SHOPIFY_API_SECRET ?? "dev-secret";

/** Stateless CSRF-safe OAuth state: shop + expiry + HMAC. */
export function makeState(shop: string): string {
  const exp = Date.now() + 10 * 60_000;
  const payload = `${shop}|${exp}`;
  const sig = crypto.createHmac("sha256", stateSecret()).update(payload).digest("hex");
  return Buffer.from(`${payload}|${sig}`).toString("base64url");
}

export function verifyState(state: string): string {
  const [shop, expStr, sig] = Buffer.from(state, "base64url").toString().split("|");
  const payload = `${shop}|${expStr}`;
  const expect = crypto.createHmac("sha256", stateSecret()).update(payload).digest("hex");
  if (!sig || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) {
    throw new Response("Invalid OAuth state", { status: 400 });
  }
  if (Date.now() > Number(expStr)) {
    throw new Response("OAuth state expired — please retry connecting", { status: 400 });
  }
  return shop;
}

export async function saveTokens(shop: string, t: QboTokens): Promise<void> {
  const cfg = qboConfig();
  await prisma.qboConnection.upsert({
    where: { shop },
    create: {
      shop,
      realmId: t.realmId,
      accessToken: t.accessToken,
      refreshToken: t.refreshToken,
      expiresAt: new Date(t.expiresAt),
      env: cfg.env,
    },
    update: {
      realmId: t.realmId,
      accessToken: t.accessToken,
      refreshToken: t.refreshToken,
      expiresAt: new Date(t.expiresAt),
    },
  });
}

/** Build a client for the shop, or null if not connected yet. */
export async function qboClientFor(shop: string): Promise<QboClient | null> {
  const row = await prisma.qboConnection.findUnique({ where: { shop } });
  if (!row) return null;
  const cfg = qboConfig();
  return new QboClient({
    cfg,
    env: row.env === "production" ? "production" : "sandbox",
    tokens: {
      accessToken: row.accessToken,
      refreshToken: row.refreshToken,
      expiresAt: row.expiresAt.getTime(),
      realmId: row.realmId,
    },
    onTokens: (t) => saveTokens(shop, t),
  });
}
