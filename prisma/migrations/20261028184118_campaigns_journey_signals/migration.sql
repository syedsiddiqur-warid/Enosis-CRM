-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "campaignId" TEXT;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "callStatus" TEXT,
ADD COLUMN     "connectedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "crtCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastCallAt" TIMESTAMP(3),
ADD COLUMN     "lastEnrichedAt" TIMESTAMP(3),
ADD COLUMN     "lastSignalAt" TIMESTAMP(3),
ADD COLUMN     "leadStateAt" TIMESTAMP(3),
ADD COLUMN     "researchStatus" TEXT,
ADD COLUMN     "researchedAt" TIMESTAMP(3),
ADD COLUMN     "researcherId" TEXT,
ADD COLUMN     "signalTypes" TEXT[];

-- CreateTable
CREATE TABLE "JourneyEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fromStage" TEXT,
    "toStage" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "source" TEXT NOT NULL,
    "reason" TEXT,
    "campaignId" TEXT,
    "activityId" TEXT,

    CONSTRAINT "JourneyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyingSignal" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "url" TEXT,
    "source" TEXT NOT NULL,
    "strength" TEXT NOT NULL DEFAULT 'Medium',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyingSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "ownerId" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "criteria" JSONB NOT NULL DEFAULT '[]',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "goals" JSONB NOT NULL DEFAULT '{}',
    "pitch" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignCompany" (
    "campaignId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Queued',
    "addedVia" TEXT NOT NULL DEFAULT 'manual',
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedById" TEXT,
    "assignedToId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "connects" INTEGER NOT NULL DEFAULT 0,
    "lastCallAt" TIMESTAMP(3),
    "lastResult" TEXT,
    "nextActionAt" TIMESTAMP(3),
    "notes" TEXT,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "CampaignCompany_pkey" PRIMARY KEY ("campaignId","companyId")
);

-- CreateTable
CREATE TABLE "Integration" (
    "provider" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "lastRunAt" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("provider")
);

-- CreateTable
CREATE TABLE "EnrichmentRun" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "companyId" TEXT,
    "status" TEXT NOT NULL,
    "changes" JSONB,
    "error" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnrichmentRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JourneyEvent_companyId_at_idx" ON "JourneyEvent"("companyId", "at");

-- CreateIndex
CREATE INDEX "JourneyEvent_toStage_at_idx" ON "JourneyEvent"("toStage", "at");

-- CreateIndex
CREATE INDEX "BuyingSignal_companyId_idx" ON "BuyingSignal"("companyId");

-- CreateIndex
CREATE INDEX "BuyingSignal_type_detectedAt_idx" ON "BuyingSignal"("type", "detectedAt");

-- CreateIndex
CREATE INDEX "Campaign_status_idx" ON "Campaign"("status");

-- CreateIndex
CREATE INDEX "CampaignCompany_companyId_idx" ON "CampaignCompany"("companyId");

-- CreateIndex
CREATE INDEX "CampaignCompany_campaignId_status_idx" ON "CampaignCompany"("campaignId", "status");

-- CreateIndex
CREATE INDEX "EnrichmentRun_companyId_idx" ON "EnrichmentRun"("companyId");

-- CreateIndex
CREATE INDEX "Activity_campaignId_idx" ON "Activity"("campaignId");

-- CreateIndex
CREATE INDEX "Company_leadState_idx" ON "Company"("leadState");

-- CreateIndex
CREATE INDEX "Company_researcherId_idx" ON "Company"("researcherId");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_researcherId_fkey" FOREIGN KEY ("researcherId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyEvent" ADD CONSTRAINT "JourneyEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyingSignal" ADD CONSTRAINT "BuyingSignal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignCompany" ADD CONSTRAINT "CampaignCompany_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignCompany" ADD CONSTRAINT "CampaignCompany_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignCompany" ADD CONSTRAINT "CampaignCompany_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrichmentRun" ADD CONSTRAINT "EnrichmentRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
