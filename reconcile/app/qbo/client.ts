/**
 * Minimal QuickBooks Online API client — only what reconcile needs:
 * JournalEntry create, Account/JournalEntry query, CompanyInfo.
 *
 * Idempotency: QBO has no idempotency keys. Every journal entry we post
 * carries DocNumber = "RC-<payoutId>"; before posting we query for that
 * DocNumber and update-instead-of-create on a hit. Combined with the
 * QboPosting DB record this makes retries safe (read-check-then-write).
 */
import { refreshTokens, type QboOauthConfig, type QboTokens } from "./oauth";

export interface QboClientOptions {
  cfg: QboOauthConfig;
  tokens: QboTokens;
  /** sandbox or production API host */
  env: "sandbox" | "production";
  /** called whenever tokens rotate so the caller can persist them */
  onTokens: (t: QboTokens) => Promise<void>;
  fetchImpl?: typeof fetch; // injectable for tests
}

export interface QboAccount {
  Id: string;
  Name: string;
  AccountType: string;
  AccountSubType?: string;
  CurrencyRef?: { value: string };
}

export interface QboJournalEntry {
  Id?: string;
  SyncToken?: string;
  DocNumber: string;
  TxnDate: string;
  PrivateNote?: string;
  Line: Array<{
    Description?: string;
    Amount: number; // decimal dollars, 2dp
    DetailType: "JournalEntryLineDetail";
    JournalEntryLineDetail: {
      PostingType: "Debit" | "Credit";
      AccountRef: { value: string };
    };
  }>;
}

export class QboApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = "QboApiError";
  }
}

const HOSTS = {
  sandbox: "https://sandbox-quickbooks.api.intuit.com",
  production: "https://quickbooks.api.intuit.com",
};

export class QboClient {
  private tokens: QboTokens;
  private readonly f: typeof fetch;

  constructor(private readonly opts: QboClientOptions) {
    this.tokens = opts.tokens;
    this.f = opts.fetchImpl ?? fetch;
  }

  private base(): string {
    return `${HOSTS[this.opts.env]}/v3/company/${this.tokens.realmId}`;
  }

  private async ensureFreshToken(): Promise<void> {
    if (Date.now() < this.tokens.expiresAt) return;
    this.tokens = await refreshTokens(this.opts.cfg, this.tokens);
    await this.opts.onTokens(this.tokens);
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    retried = false,
  ): Promise<T> {
    await this.ensureFreshToken();
    const res = await this.f(`${this.base()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.tokens.accessToken}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && !retried) {
      // token revoked/expired server-side: force refresh once and retry
      this.tokens = { ...this.tokens, expiresAt: 0 };
      return this.request(method, path, body, true);
    }
    const text = await res.text();
    if (!res.ok) {
      throw new QboApiError(`QBO ${method} ${path} -> ${res.status}`, res.status, text);
    }
    return JSON.parse(text) as T;
  }

  /** Run a QBO SQL-ish query, e.g. "select * from Account where AccountType='Income'" */
  async query<T>(q: string): Promise<T[]> {
    const d = await this.request<{ QueryResponse: Record<string, T[] | undefined> }>(
      "GET",
      `/query?query=${encodeURIComponent(q)}&minorversion=75`,
    );
    // response key mirrors the entity name; take the first array value
    const arrays = Object.values(d.QueryResponse).filter(Array.isArray);
    return (arrays[0] as T[]) ?? [];
  }

  listAccounts(): Promise<QboAccount[]> {
    return this.query<QboAccount>(
      "select Id, Name, AccountType, AccountSubType, CurrencyRef from Account where Active = true maxresults 1000",
    );
  }

  async findJournalEntryByDocNumber(docNumber: string): Promise<QboJournalEntry | null> {
    const hits = await this.query<QboJournalEntry>(
      `select * from JournalEntry where DocNumber = '${docNumber.replace(/'/g, "\\'")}'`,
    );
    return hits[0] ?? null;
  }

  async createJournalEntry(entry: QboJournalEntry): Promise<QboJournalEntry> {
    const d = await this.request<{ JournalEntry: QboJournalEntry }>(
      "POST",
      "/journalentry?minorversion=75",
      entry,
    );
    return d.JournalEntry;
  }

  /** Sparse-update an existing entry (same DocNumber, new lines). */
  async updateJournalEntry(entry: QboJournalEntry): Promise<QboJournalEntry> {
    if (!entry.Id || entry.SyncToken === undefined) {
      throw new Error("updateJournalEntry requires Id and SyncToken");
    }
    const d = await this.request<{ JournalEntry: QboJournalEntry }>(
      "POST",
      "/journalentry?minorversion=75",
      entry,
    );
    return d.JournalEntry;
  }

  async companyInfo(): Promise<{ CompanyName: string; Country?: string }> {
    const d = await this.request<{ CompanyInfo: { CompanyName: string; Country?: string } }>(
      "GET",
      `/companyinfo/${this.tokens.realmId}?minorversion=75`,
    );
    return d.CompanyInfo;
  }
}
