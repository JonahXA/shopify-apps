/**
 * Intuit OAuth2 helpers. Pure functions + fetch; token persistence lives in
 * the caller (Prisma QboConnection).
 *
 * Credential gate: QBO_CLIENT_ID / QBO_CLIENT_SECRET come from Jonah's Intuit
 * Developer app registration. Code is complete against the sandbox spec.
 */

const AUTH_BASE = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

export interface QboOauthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface QboTokens {
  accessToken: string;
  refreshToken: string;
  /** epoch ms when the access token expires */
  expiresAt: number;
  realmId: string;
}

export function authorizeUrl(cfg: QboOauthConfig, state: string): string {
  const p = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    scope: "com.intuit.quickbooks.accounting",
    redirect_uri: cfg.redirectUri,
    state,
  });
  return `${AUTH_BASE}?${p}`;
}

function basicAuth(cfg: QboOauthConfig): string {
  return "Basic " + Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
}

async function tokenRequest(
  cfg: QboOauthConfig,
  body: URLSearchParams,
  realmId: string,
): Promise<QboTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuth(cfg),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`QBO token request failed: ${res.status} ${await res.text()}`);
  }
  const d = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  return {
    accessToken: d.access_token,
    refreshToken: d.refresh_token, // rotates — caller MUST persist every time
    expiresAt: Date.now() + d.expires_in * 1000 - 60_000, // 60s safety margin
    realmId,
  };
}

/** Exchange the authorization code from the OAuth callback. */
export function exchangeCode(
  cfg: QboOauthConfig,
  code: string,
  realmId: string,
): Promise<QboTokens> {
  return tokenRequest(
    cfg,
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: cfg.redirectUri,
    }),
    realmId,
  );
}

/** Refresh an access token. Intuit rotates refresh tokens: persist the result. */
export function refreshTokens(cfg: QboOauthConfig, tokens: QboTokens): Promise<QboTokens> {
  return tokenRequest(
    cfg,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
    }),
    tokens.realmId,
  );
}
