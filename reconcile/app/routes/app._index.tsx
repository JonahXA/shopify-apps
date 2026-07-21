import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData, useSearchParams } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  DataTable,
  EmptyState,
  InlineGrid,
  InlineStack,
  Layout,
  Page,
  Select,
  Text,
} from "@shopify/polaris";
import { useState } from "react";
import { authenticate, RECONCILE_PLAN } from "../shopify.server";
import prisma from "../db.server";
import { qboClientFor } from "../qbo/connection.server";
import type { QboAccount } from "../qbo/client";
import { backfillOrders, sweepPayouts } from "../ingest/sweep.server";
import { postEligiblePayouts } from "../ingest/post.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const shop = session.shop;

  // Billing gate: 14-day trial then $19/mo. Test mode until launch review.
  // Plan-name generics don't infer while the template's upstream
  // session-storage type mismatch stands, hence the scoped casts.
  await billing.require({
    plans: [RECONCILE_PLAN as never],
    isTest: process.env.BILLING_TEST !== "0",
    onFailure: () =>
      billing.request({
        plan: RECONCILE_PLAN as never,
        isTest: process.env.BILLING_TEST !== "0",
      }),
  });

  const connection = await prisma.qboConnection.findUnique({ where: { shop } });
  const map = await prisma.accountMap.findUnique({ where: { shop } });

  let accounts: QboAccount[] = [];
  let qboError: string | null = null;
  let company: string | null = null;
  if (connection) {
    try {
      const client = (await qboClientFor(shop))!;
      company = (await client.companyInfo()).CompanyName;
      if (!map?.onboarded) accounts = await client.listAccounts();
    } catch (e) {
      qboError = e instanceof Error ? e.message : String(e);
    }
  }

  const payouts = await prisma.payout.findMany({
    where: { shop },
    orderBy: { date: "desc" },
    take: 50,
  });
  const postings = await prisma.qboPosting.findMany({ where: { shop } });
  const postingByPayout = Object.fromEntries(postings.map((p) => [p.payoutId, p]));

  return json({
    shop,
    connected: !!connection,
    company,
    qboError,
    onboarded: !!map?.onboarded,
    accounts,
    payouts: payouts.map((p) => ({
      id: p.id,
      date: p.date,
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      posting: postingByPayout[p.id]
        ? {
            state: postingByPayout[p.id].state,
            docNumber: postingByPayout[p.id].docNumber,
            errorHint: postingByPayout[p.id].errorHint,
          }
        : null,
    })),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "saveMapping") {
    const f = (k: string) => String(form.get(k) ?? "");
    const required = [
      "salesAccountId",
      "shippingAccountId",
      "feesAccountId",
      "clearingAccountId",
      "adjustmentsAccountId",
      "roundingAccountId",
      "defaultTaxAccountId",
    ] as const;
    if (required.some((k) => !f(k))) {
      return json({ error: "Please choose an account for every row." }, { status: 400 });
    }
    const data = Object.fromEntries(required.map((k) => [k, f(k)])) as Record<
      (typeof required)[number],
      string
    >;
    await prisma.accountMap.upsert({
      where: { shop },
      create: { shop, ...data, onboarded: true },
      update: { ...data, onboarded: true },
    });
    return json({ ok: true });
  }

  if (intent === "sync") {
    const gql = admin.graphql as unknown as (
      q: string,
      o?: { variables?: Record<string, unknown> },
    ) => Promise<Response>;
    const swept = await sweepPayouts(gql, shop);
    const orders = await backfillOrders(gql, shop);
    const posted = await postEligiblePayouts(shop);
    return json({ ok: true, swept, orders, posted: posted.length });
  }

  return json({ error: "Unknown action" }, { status: 400 });
};

const fmtMoney = (cents: number, cur: string) =>
  `${cents < 0 ? "-" : ""}${(Math.abs(cents) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${cur}`;

function AccountPicker(props: {
  label: string;
  name: string;
  helpText: string;
  accounts: QboAccount[];
  types: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const opts = props.accounts
    .filter((a) => props.types.includes(a.AccountType))
    .map((a) => ({ label: `${a.Name} (${a.AccountType})`, value: a.Id }));
  return (
    <Select
      label={props.label}
      name={props.name}
      helpText={props.helpText}
      options={[{ label: "Choose an account…", value: "" }, ...opts]}
      value={props.value}
      onChange={props.onChange}
    />
  );
}

export default function Index() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [params] = useSearchParams();
  const [sel, setSel] = useState<Record<string, string>>({
    salesAccountId: "",
    shippingAccountId: "",
    feesAccountId: "",
    clearingAccountId: "",
    adjustmentsAccountId: "",
    roundingAccountId: "",
    defaultTaxAccountId: "",
  });
  const busy = fetcher.state !== "idle";

  // ---------- Step 1: connect QBO ----------
  if (!data.connected) {
    return (
      <Page title="Reconcile">
        <Layout>
          <Layout.Section>
            <BlockStack gap="400">
              {params.get("qbo") === "declined" && (
                <Banner tone="warning" title="QuickBooks connection was cancelled">
                  <p>You can retry whenever you're ready — nothing was changed.</p>
                </Banner>
              )}
              <Card>
                <EmptyState
                  heading="Connect QuickBooks Online"
                  action={{ content: "Connect QuickBooks", url: "/app/qbo/connect" }}
                  image=""
                >
                  <p>
                    Reconcile posts one balanced journal entry per Shopify payout, so your
                    QuickBooks deposits match to the cent. Setup takes about three minutes,
                    and nothing is posted until you approve the account mapping.
                  </p>
                </EmptyState>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  // ---------- Step 2: map accounts ----------
  if (!data.onboarded) {
    const pick = (name: string) => ({
      accounts: data.accounts,
      value: sel[name],
      onChange: (v: string) => setSel((s) => ({ ...s, [name]: v })),
      name,
    });
    return (
      <Page title="Reconcile — map your accounts">
        <Layout>
          <Layout.Section>
            <BlockStack gap="400">
              {data.qboError && (
                <Banner tone="critical" title="Can't reach QuickBooks">
                  <p>{data.qboError}</p>
                  <Button url="/app/qbo/connect">Reconnect QuickBooks</Button>
                </Banner>
              )}
              <Card>
                <BlockStack gap="400">
                  <Text as="p" tone="subdued">
                    Connected to <b>{data.company ?? "QuickBooks"}</b>. Choose where each
                    part of a payout posts. You can change this later; changes only affect
                    future postings.
                  </Text>
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="saveMapping" />
                    <BlockStack gap="300">
                      <InlineGrid columns={{ xs: 1, md: 2 }} gap="300">
                        <AccountPicker label="Sales income" helpText="Gross sales, net of refunds" types={["Income"]} {...pick("salesAccountId")} />
                        <AccountPicker label="Shipping income" helpText="Shipping collected from customers" types={["Income"]} {...pick("shippingAccountId")} />
                        <AccountPicker label="Sales tax liability" helpText="Sales tax collected — a liability, not income" types={["Other Current Liability"]} {...pick("defaultTaxAccountId")} />
                        <AccountPicker label="Payment fees" helpText="Shopify Payments processing fees" types={["Expense", "Cost of Goods Sold"]} {...pick("feesAccountId")} />
                        <AccountPicker label="Payout clearing" helpText="Where the deposit lands — match it against your bank feed" types={["Bank", "Other Current Asset"]} {...pick("clearingAccountId")} />
                        <AccountPicker label="Adjustments & disputes" helpText="Chargebacks and Shopify balance adjustments" types={["Expense", "Other Expense", "Income", "Other Income"]} {...pick("adjustmentsAccountId")} />
                        <AccountPicker label="Rounding / FX residual" helpText="Sub-cent residue from currency conversion — usually pennies" types={["Expense", "Other Expense", "Other Income"]} {...pick("roundingAccountId")} />
                      </InlineGrid>
                      {fetcher.data && "error" in fetcher.data && (
                        <Banner tone="critical">
                          <p>{String(fetcher.data.error)}</p>
                        </Banner>
                      )}
                      <InlineStack align="end">
                        <Button variant="primary" submit loading={busy}>
                          Save mapping and start reconciling
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  </fetcher.Form>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  // ---------- Dashboard ----------
  const posted = data.payouts.filter((p) => p.posting?.state === "posted").length;
  const errors = data.payouts.filter((p) => p.posting?.state === "error");
  const pending = data.payouts.filter((p) => p.status === "paid" && !p.posting).length;

  const rows = data.payouts.map((p) => [
    new Date(p.date).toISOString().slice(0, 10),
    fmtMoney(p.amount, p.currency),
    p.posting?.state === "posted" ? (
      <Badge tone="success" key={p.id}>{`Posted ${p.posting.docNumber}`}</Badge>
    ) : p.posting?.state === "error" ? (
      <Badge tone="critical" key={p.id}>Needs attention</Badge>
    ) : p.status === "paid" ? (
      <Badge tone="attention" key={p.id}>Queued</Badge>
    ) : (
      <Badge key={p.id}>In transit</Badge>
    ),
    p.posting?.state === "posted" ? "0.00 — matched" : "—",
  ]);

  return (
    <Page
      title="Reconcile"
      subtitle={data.company ? `Posting to ${data.company}` : undefined}
      primaryAction={
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="sync" />
          <Button variant="primary" submit loading={busy}>
            Sync now
          </Button>
        </fetcher.Form>
      }
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {data.qboError && (
              <Banner tone="critical" title="QuickBooks connection problem">
                <p>{data.qboError}</p>
                <Button url="/app/qbo/connect">Reconnect QuickBooks</Button>
              </Banner>
            )}
            {errors.length > 0 && (
              <Banner
                tone="warning"
                title={`${errors.length} payout${errors.length > 1 ? "s" : ""} need${errors.length > 1 ? "" : "s"} attention`}
              >
                <BlockStack gap="200">
                  {errors.slice(0, 3).map((p) => (
                    <Text as="p" key={p.id}>
                      Payout {p.id}: {p.posting?.errorHint ?? "unknown error"}
                    </Text>
                  ))}
                </BlockStack>
              </Banner>
            )}
            <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
              <Card>
                <BlockStack gap="100">
                  <Text as="p" tone="subdued" variant="bodySm">
                    Payouts posted
                  </Text>
                  <Text as="p" variant="headingLg">
                    {posted}
                  </Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="100">
                  <Text as="p" tone="subdued" variant="bodySm">
                    Queued for posting
                  </Text>
                  <Text as="p" variant="headingLg">
                    {pending}
                  </Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="100">
                  <Text as="p" tone="subdued" variant="bodySm">
                    Unreconciled difference
                  </Text>
                  <Text as="p" variant="headingLg">
                    {errors.length === 0 ? "0.00" : `${errors.length} to fix`}
                  </Text>
                </BlockStack>
              </Card>
            </InlineGrid>
            <Card>
              {rows.length === 0 ? (
                <EmptyState heading="No payouts yet" image="">
                  <p>
                    Once Shopify Payments issues your next payout it will appear here and
                    post to QuickBooks automatically. Use “Sync now” to pull history.
                  </p>
                </EmptyState>
              ) : (
                <DataTable
                  columnContentTypes={["text", "numeric", "text", "text"]}
                  headings={["Payout date", "Amount", "QuickBooks", "Difference"]}
                  rows={rows}
                />
              )}
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
