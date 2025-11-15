-- CreateTable
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "userId" TEXT,
    "raindropCollectionId" TEXT,
    "activeStrategyVersion" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "StrategyConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "topicId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "rolloutPercentage" INTEGER NOT NULL DEFAULT 100,
    "parentVersion" INTEGER,
    "configJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StrategyConfig_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "topicId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Note_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Episode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "topicId" TEXT NOT NULL,
    "userId" TEXT,
    "strategyVersion" INTEGER NOT NULL,
    "query" TEXT NOT NULL,
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

-- CreateTable
CREATE TABLE "StrategyEvolutionLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "topicId" TEXT NOT NULL,
    "fromVersion" INTEGER,
    "toVersion" INTEGER NOT NULL,
    "reason" TEXT,
    "changesJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StrategyEvolutionLog_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Topic_userId_idx" ON "Topic"("userId");

-- CreateIndex
CREATE INDEX "StrategyConfig_topicId_status_idx" ON "StrategyConfig"("topicId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StrategyConfig_topicId_version_key" ON "StrategyConfig"("topicId", "version");

-- CreateIndex
CREATE INDEX "Note_topicId_idx" ON "Note"("topicId");

-- CreateIndex
CREATE INDEX "Note_createdAt_idx" ON "Note"("createdAt");

-- CreateIndex
CREATE INDEX "Episode_topicId_strategyVersion_idx" ON "Episode"("topicId", "strategyVersion");

-- CreateIndex
CREATE INDEX "Episode_createdAt_idx" ON "Episode"("createdAt");

-- CreateIndex
CREATE INDEX "StrategyEvolutionLog_topicId_idx" ON "StrategyEvolutionLog"("topicId");

-- CreateIndex
CREATE INDEX "StrategyEvolutionLog_createdAt_idx" ON "StrategyEvolutionLog"("createdAt");
