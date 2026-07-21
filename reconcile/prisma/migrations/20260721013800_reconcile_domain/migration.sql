-- CreateTable
CREATE TABLE "QboConnection" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "realmId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "env" TEXT NOT NULL DEFAULT 'sandbox',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AccountMap" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "salesAccountId" TEXT NOT NULL,
    "shippingAccountId" TEXT NOT NULL,
    "feesAccountId" TEXT NOT NULL,
    "clearingAccountId" TEXT NOT NULL,
    "adjustmentsAccountId" TEXT NOT NULL,
    "roundingAccountId" TEXT NOT NULL,
    "defaultTaxAccountId" TEXT NOT NULL,
    "taxAccountsJson" TEXT NOT NULL DEFAULT '{}',
    "onboarded" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "ShopOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "shipping" INTEGER NOT NULL,
    "taxJson" TEXT NOT NULL DEFAULT '[]',
    "total" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ShopRefund" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "shipping" INTEGER NOT NULL,
    "taxJson" TEXT NOT NULL DEFAULT '[]',
    "total" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "BalanceTxn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "payoutId" TEXT,
    "type" TEXT NOT NULL,
    "sourceId" TEXT,
    "currency" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "fee" INTEGER NOT NULL,
    "net" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "QboPosting" (
    "payoutId" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "docNumber" TEXT NOT NULL,
    "qboId" TEXT,
    "state" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorHint" TEXT,
    "planJson" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "postedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "ShopOrder_shop_idx" ON "ShopOrder"("shop");

-- CreateIndex
CREATE INDEX "ShopRefund_shop_idx" ON "ShopRefund"("shop");

-- CreateIndex
CREATE INDEX "BalanceTxn_shop_payoutId_idx" ON "BalanceTxn"("shop", "payoutId");

-- CreateIndex
CREATE INDEX "Payout_shop_status_idx" ON "Payout"("shop", "status");

-- CreateIndex
CREATE INDEX "QboPosting_shop_state_idx" ON "QboPosting"("shop", "state");
