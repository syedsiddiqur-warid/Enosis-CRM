-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "readyAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Company_readyAt_idx" ON "Company"("readyAt");


-- Backfill: companies research already marked callable start waiting from when that happened
UPDATE "Company"
SET "readyAt" = COALESCE(
  CASE WHEN properties->>'callableCheckedOn' ~ '^\d{4}-\d{2}-\d{2}T' THEN (properties->>'callableCheckedOn')::timestamptz END,
  "researchedAt",
  "updatedAt"
)
WHERE properties->>'callable' = 'Yes' AND "readyAt" IS NULL;
