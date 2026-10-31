-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "feedbackRating" TEXT,
ADD COLUMN     "feedbackTags" TEXT[],
ADD COLUMN     "revisitAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "followCallerId" TEXT,
ADD COLUMN     "followGroup" TEXT,
ADD COLUMN     "followReason" TEXT,
ADD COLUMN     "followScore" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "followUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "revisitAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Company_followGroup_followScore_idx" ON "Company"("followGroup", "followScore");
