-- AlterTable
ALTER TABLE "SegmentMember" ADD COLUMN     "addedById" TEXT,
ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "contactId" TEXT;

-- CreateIndex
CREATE INDEX "SegmentMember_contactId_idx" ON "SegmentMember"("contactId");

-- CreateIndex
CREATE INDEX "SegmentMember_companyId_idx" ON "SegmentMember"("companyId");

-- AddForeignKey
ALTER TABLE "SegmentMember" ADD CONSTRAINT "SegmentMember_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SegmentMember" ADD CONSTRAINT "SegmentMember_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
