-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Episode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "topicId" TEXT NOT NULL,
    "userId" TEXT,
    "strategyVersion" INTEGER NOT NULL,
    "query" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "sourcesReturned" TEXT NOT NULL,
    "sourcesSaved" TEXT NOT NULL,
    "toolUsage" TEXT,
    "followupCount" INTEGER NOT NULL DEFAULT 0,
    "sensoSearchUsed" BOOLEAN NOT NULL DEFAULT false,
    "sensoGenerateUsed" BOOLEAN NOT NULL DEFAULT false,
    "resultNoteId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Episode_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Episode_resultNoteId_fkey" FOREIGN KEY ("resultNoteId") REFERENCES "Note" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Episode" ("createdAt", "followupCount", "id", "query", "resultNoteId", "sensoGenerateUsed", "sensoSearchUsed", "sourcesReturned", "sourcesSaved", "strategyVersion", "toolUsage", "topicId", "userId") SELECT "createdAt", "followupCount", "id", "query", "resultNoteId", "sensoGenerateUsed", "sensoSearchUsed", "sourcesReturned", "sourcesSaved", "strategyVersion", "toolUsage", "topicId", "userId" FROM "Episode";
DROP TABLE "Episode";
ALTER TABLE "new_Episode" RENAME TO "Episode";
CREATE INDEX "Episode_topicId_strategyVersion_idx" ON "Episode"("topicId", "strategyVersion");
CREATE INDEX "Episode_createdAt_idx" ON "Episode"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
