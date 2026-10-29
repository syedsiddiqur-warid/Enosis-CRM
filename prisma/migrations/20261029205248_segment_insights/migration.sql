-- AlterTable
ALTER TABLE "Segment" ADD COLUMN     "description" TEXT,
ADD COLUMN     "exclusions" JSONB;

-- CreateTable
CREATE TABLE "SegmentSnapshot" (
    "segmentId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "size" INTEGER NOT NULL,

    CONSTRAINT "SegmentSnapshot_pkey" PRIMARY KEY ("segmentId","day")
);

-- AddForeignKey
ALTER TABLE "SegmentSnapshot" ADD CONSTRAINT "SegmentSnapshot_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "Segment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
