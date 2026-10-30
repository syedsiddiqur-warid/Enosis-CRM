-- CreateTable
CREATE TABLE "ResearchRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contactId" TEXT,
    "campaignId" TEXT,
    "kind" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "requestedById" TEXT,
    "researcherId" TEXT,
    "result" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "seenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResearchRequest_status_idx" ON "ResearchRequest"("status");

-- CreateIndex
CREATE INDEX "ResearchRequest_companyId_idx" ON "ResearchRequest"("companyId");

-- CreateIndex
CREATE INDEX "ResearchRequest_requestedById_status_idx" ON "ResearchRequest"("requestedById", "status");

-- AddForeignKey
ALTER TABLE "ResearchRequest" ADD CONSTRAINT "ResearchRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchRequest" ADD CONSTRAINT "ResearchRequest_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchRequest" ADD CONSTRAINT "ResearchRequest_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchRequest" ADD CONSTRAINT "ResearchRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchRequest" ADD CONSTRAINT "ResearchRequest_researcherId_fkey" FOREIGN KEY ("researcherId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
