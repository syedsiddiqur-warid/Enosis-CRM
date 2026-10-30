-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "audience" TEXT NOT NULL DEFAULT 'COMPANY';

-- CreateTable
CREATE TABLE "CampaignContact" (
    "campaignId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "connects" INTEGER NOT NULL DEFAULT 0,
    "lastResult" TEXT,
    "lastCallAt" TIMESTAMP(3),
    "addedVia" TEXT NOT NULL DEFAULT 'manual',
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedById" TEXT,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "CampaignContact_pkey" PRIMARY KEY ("campaignId","contactId")
);

-- CreateIndex
CREATE INDEX "CampaignContact_campaignId_companyId_idx" ON "CampaignContact"("campaignId", "companyId");

-- CreateIndex
CREATE INDEX "CampaignContact_contactId_idx" ON "CampaignContact"("contactId");

-- AddForeignKey
ALTER TABLE "CampaignContact" ADD CONSTRAINT "CampaignContact_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignContact" ADD CONSTRAINT "CampaignContact_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignContact" ADD CONSTRAINT "CampaignContact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
