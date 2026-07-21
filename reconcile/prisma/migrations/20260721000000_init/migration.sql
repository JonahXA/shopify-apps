-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "QboConnection" (
    "shop" TEXT NOT NULL,
    "realmId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "env" TEXT NOT NULL DEFAULT 'sandbox',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QboConnection_pkey" PRIMARY KEY ("shop")
);

-- CreateTable
CREATE TABLE "AccountMap" (
    "shop" TEXT NOT NULL,
    "salesAccountId" TEXT NOT NULL,
    "shippingAccountId" TEXT NOT NULL,
    "feesAccountId" TEXT NOT NULL,
    "clearingAccountId" TEXT NOT NULL,
    "adjustmentsAccountId" TEXT NOT NULL,
    "roundingAccountId" TEXT NOT NULL,
    "defaultTaxAccountId" TEXT NOT NULL,
    "taxAccountsJson" TEXT NOT NULL DEFAULT '{}',
    "onboarded" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AccountMap_pkey" PRIMARY KEY ("shop")
);

-- CreateTable
CREATE TABLE "ShopOrder" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "shipping" INTEGER NOT NULL,
    "taxJson" TEXT NOT NULL DEFAULT '[]',
    "total" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopRefund" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "shipping" INTEGER NOT NULL,
    "taxJson" TEXT NOT NULL DEFAULT '[]',
    "total" INTEGER NOT NULL,

    CONSTRAINT "ShopRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BalanceTxn" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "payoutId" TEXT,
    "type" TEXT NOT NULL,
    "sourceId" TEXT,
    "currency" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "fee" INTEGER NOT NULL,
    "net" INTEGER NOT NULL,

    CONSTRAINT "BalanceTxn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QboPosting" (
    "payoutId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "docNumber" TEXT NOT NULL,
    "qboId" TEXT,
    "state" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorHint" TEXT,
    "planJson" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "postedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QboPosting_pkey" PRIMARY KEY ("payoutId")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
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

