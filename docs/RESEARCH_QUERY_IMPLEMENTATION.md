# Research Query Implementation Plan

## Executive Summary

This document outlines what's needed to implement the **"Ask a question → Run research → Show result"** flow for the DeepCurrent Topics system.

**Current State:**
- ✅ Database schema (Topic, Episode, Note, StrategyConfig)
- ✅ Repositories for CRUD operations
- ✅ Mastra research agent (`researchAgent`)
- ✅ Frontend QueryInput component
- ✅ Topics UI with real database integration
- ❌ **Inngest is NOT installed** (mentioned in user's request but not in dependencies)
- ❌ Episode model missing `status` and `errorMessage` fields
- ❌ No `/ask` API endpoint
- ❌ No polling mechanism in frontend
- ❌ No workflow orchestration

## Architecture Options

### Option A: Simple Direct Execution (Recommended for MVP)
**Flow:** FE → API → Mastra Agent → Update DB → Return
- **Pros:** Simple, no new dependencies, fast to implement
- **Cons:** API request waits for entire research to complete (could timeout)
- **Best for:** Quick prototype, testing the workflow

### Option B: Background Job Processing with Inngest
**Flow:** FE → API → Create Episode → Inngest Event → Workflow → Update DB → FE polls
- **Pros:** Non-blocking, scalable, user gets immediate feedback
- **Cons:** Requires Inngest setup, more moving parts
- **Best for:** Production system

**Recommendation:** Start with Option A, migrate to Option B later.

---

## What Needs to Be Built

### 1. Database Schema Changes

#### Add `status` and `errorMessage` to Episode model

**File:** `prisma/schema.prisma`

```prisma
model Episode {
  id                String   @id @default(cuid())
  topicId           String
  userId            String?
  strategyVersion   Int
  query             String

  // NEW FIELDS
  status            String   @default("pending")  // "pending" | "running" | "completed" | "failed"
  errorMessage      String?                       // Error details if failed

  // Existing fields
  sourcesReturned   String
  sourcesSaved      String
  toolUsage         String?
  followupCount     Int      @default(0)
  sensoSearchUsed   Boolean  @default(false)
  sensoGenerateUsed Boolean  @default(false)

  topic             Topic    @relation(fields: [topicId], references: [id], onDelete: Cascade)
  note              Note?    @relation(fields: [resultNoteId], references: [id], onDelete: SetNull)
  resultNoteId      String?

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt  // NEW: Track updates

  @@index([topicId, strategyVersion])
  @@index([topicId, status])  // NEW: Index for polling
  @@index([createdAt])
}
```

**Migration:**
```bash
npx prisma migrate dev --name add_episode_status
```

---

### 2. Repository Updates

#### Update Episode repository types

**File:** `src/repositories/types.ts`

```typescript
export interface CreateEpisodeInput {
  topicId: string;
  userId?: string;
  strategyVersion: number;
  query: string;
  status?: 'pending' | 'running' | 'completed' | 'failed';
  sourcesReturned: SourceRef[];
  sourcesSaved: SourceRef[];
  toolUsage?: Record<string, unknown>;
  followupCount?: number;
  resultNoteId?: string;
  sensoSearchUsed?: boolean;
  sensoGenerateUsed?: boolean;
  errorMessage?: string;
}
```

#### Add new repository functions

**File:** `src/repositories/episodes.ts`

```typescript
/**
 * Update episode status
 */
export async function updateEpisodeStatus(
  episodeId: string,
  status: 'pending' | 'running' | 'completed' | 'failed',
  data?: {
    resultNoteId?: string;
    errorMessage?: string;
    sourcesReturned?: SourceRef[];
    sourcesSaved?: SourceRef[];
    toolUsage?: Record<string, unknown>;
  }
): Promise<Episode> {
  return prisma.episode.update({
    where: { id: episodeId },
    data: {
      status,
      resultNoteId: data?.resultNoteId,
      errorMessage: data?.errorMessage,
      sourcesReturned: data?.sourcesReturned ? JSON.stringify(data.sourcesReturned) : undefined,
      sourcesSaved: data?.sourcesSaved ? JSON.stringify(data.sourcesSaved) : undefined,
      toolUsage: data?.toolUsage ? JSON.stringify(data.toolUsage) : undefined,
    },
  });
}

/**
 * Get pending/running episodes for a topic
 */
export async function getPendingEpisodes(topicId: string): Promise<Episode[]> {
  return prisma.episode.findMany({
    where: {
      topicId,
      status: { in: ['pending', 'running'] },
    },
    orderBy: { createdAt: 'desc' },
  });
}
```

---

### 3. Research Execution Function

Create a reusable function that runs the research agent and creates a note.

**File:** `src/lib/runResearch.ts` (NEW)

```typescript
import { researchAgent } from '@/mastra/agents/researchAgent';
import { createNote } from '@/repositories/notes';
import { updateEpisodeStatus } from '@/repositories/episodes';
import { getTopicById } from '@/repositories/topics';
import { getStrategyByVersion } from '@/repositories/strategies';
import type { SourceRef } from '@/repositories/types';

export interface ResearchResult {
  note: {
    id: string;
    title: string;
    content: string;
  };
  telemetry: {
    sourcesReturned: SourceRef[];
    sourcesSaved: SourceRef[];
    toolUsage?: Record<string, unknown>;
  };
}

export async function runResearch(episodeId: string): Promise<ResearchResult> {
  const episode = await getEpisodeById(episodeId);
  if (!episode) {
    throw new Error('Episode not found');
  }

  const topic = await getTopicById(episode.topicId);
  if (!topic) {
    throw new Error('Topic not found');
  }

  // Mark as running
  await updateEpisodeStatus(episodeId, 'running');

  try {
    // Get active strategy config (optional - can be used to configure agent)
    const strategyVersion = topic.activeStrategyVersion || 0;
    // const strategy = await getStrategyByVersion(episode.topicId, strategyVersion);

    // Run research agent
    const result = await researchAgent.generate([
      {
        role: 'user',
        content: `Research the following topic: "${episode.query}"\n\nProvide a comprehensive summary of your findings.`,
      },
    ]);

    const content = typeof result.text === 'string' ? result.text : JSON.stringify(result.text);

    // Create note
    const note = await createNote({
      topicId: episode.topicId,
      title: `Research: ${episode.query.substring(0, 60)}${episode.query.length > 60 ? '...' : ''}`,
      content,
      type: 'research',
    });

    // Extract telemetry (mock for now - enhance based on actual agent response)
    const telemetry = {
      sourcesReturned: [] as SourceRef[],
      sourcesSaved: [] as SourceRef[],
      toolUsage: {},
    };

    // Mark as completed
    await updateEpisodeStatus(episodeId, 'completed', {
      resultNoteId: note.id,
      sourcesReturned: telemetry.sourcesReturned,
      sourcesSaved: telemetry.sourcesSaved,
      toolUsage: telemetry.toolUsage,
    });

    return {
      note: {
        id: note.id,
        title: note.title,
        content: note.content,
      },
      telemetry,
    };
  } catch (error) {
    // Mark as failed
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await updateEpisodeStatus(episodeId, 'failed', {
      errorMessage,
    });
    throw error;
  }
}
```

---

### 4. API Routes

#### a. POST `/api/topics/[id]/ask` - Submit research query

**File:** `app/api/topics/[id]/ask/route.ts` (NEW)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createEpisode } from '@/repositories/episodes';
import { getTopicById } from '@/repositories/topics';
import { runResearch } from '@/lib/runResearch';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: topicId } = await params;
    const body = await request.json();
    const { query } = body;

    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { error: 'Query is required' },
        { status: 400 }
      );
    }

    // Verify topic exists
    const topic = await getTopicById(topicId);
    if (!topic) {
      return NextResponse.json(
        { error: 'Topic not found' },
        { status: 404 }
      );
    }

    // Create episode stub
    const episode = await createEpisode({
      topicId,
      query,
      strategyVersion: topic.activeStrategyVersion || 0,
      status: 'pending',
      sourcesReturned: [],
      sourcesSaved: [],
    });

    // OPTION A: Direct execution (simple, blocks until complete)
    // Uncomment this for MVP:
    /*
    try {
      await runResearch(episode.id);
    } catch (error) {
      console.error('Research failed:', error);
    }
    */

    // OPTION B: Fire and forget (return immediately)
    // This is better UX - FE will poll for completion
    runResearch(episode.id).catch((error) => {
      console.error('Research failed:', error);
    });

    return NextResponse.json({ episodeId: episode.id }, { status: 201 });
  } catch (error) {
    console.error('Error in /ask endpoint:', error);
    return NextResponse.json(
      { error: 'Failed to start research' },
      { status: 500 }
    );
  }
}
```

#### b. GET `/api/episodes/[episodeId]` - Get episode status

**File:** `app/api/episodes/[episodeId]/route.ts` (NEW)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getEpisodeById } from '@/repositories/episodes';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ episodeId: string }> }
) {
  try {
    const { episodeId } = await params;
    const episode = await getEpisodeById(episodeId);

    if (!episode) {
      return NextResponse.json(
        { error: 'Episode not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      id: episode.id,
      topicId: episode.topicId,
      query: episode.query,
      status: episode.status,
      resultNoteId: episode.resultNoteId,
      errorMessage: episode.errorMessage,
      createdAt: episode.createdAt,
    });
  } catch (error) {
    console.error('Error fetching episode:', error);
    return NextResponse.json(
      { error: 'Failed to fetch episode' },
      { status: 500 }
    );
  }
}
```

#### c. GET `/api/topics/[id]/notes` - Get notes for topic

**File:** `app/api/topics/[id]/notes/route.ts` (NEW)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { listNotesForTopic } from '@/repositories/notes';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: topicId } = await params;
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 20;

    const notes = await listNotesForTopic(topicId, limit);

    return NextResponse.json(notes.map(note => ({
      id: note.id,
      topicId: note.topicId,
      title: note.title,
      content: note.content,
      type: note.type,
      createdAt: note.createdAt.toISOString(),
    })));
  } catch (error) {
    console.error('Error fetching notes:', error);
    return NextResponse.json(
      { error: 'Failed to fetch notes' },
      { status: 500 }
    );
  }
}
```

---

### 5. Frontend API Client

**File:** `lib/api/research.ts` (NEW)

```typescript
export interface AskRequest {
  query: string;
}

export interface AskResponse {
  episodeId: string;
}

export interface EpisodeStatus {
  id: string;
  topicId: string;
  query: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  resultNoteId?: string;
  errorMessage?: string;
  createdAt: string;
}

/**
 * Submit a research query
 */
export async function askQuestion(topicId: string, query: string): Promise<AskResponse> {
  const response = await fetch(`/api/topics/${topicId}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query } satisfies AskRequest),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to submit question');
  }

  return response.json();
}

/**
 * Get episode status
 */
export async function getEpisodeStatus(episodeId: string): Promise<EpisodeStatus> {
  const response = await fetch(`/api/episodes/${episodeId}`);

  if (!response.ok) {
    throw new Error('Failed to fetch episode status');
  }

  return response.json();
}

/**
 * Fetch notes for a topic
 */
export async function fetchNotes(topicId: string, limit = 20) {
  const response = await fetch(`/api/topics/${topicId}/notes?limit=${limit}`);

  if (!response.ok) {
    throw new Error('Failed to fetch notes');
  }

  return response.json();
}
```

---

### 6. Frontend Integration

**File:** `app/topics/[id]/page.tsx` (UPDATE)

```typescript
// Add to existing imports
import { askQuestion, getEpisodeStatus } from '@/lib/api/research';

// Add to component state
const [pendingRuns, setPendingRuns] = useState<{ episodeId: string; query: string }[]>([]);

// Replace the handleQuery function
const handleQuery = async (query: string) => {
  setIsQuerying(true);

  try {
    // Submit question
    const { episodeId } = await askQuestion(topicId, query);

    // Add to pending runs (optimistic UI)
    setPendingRuns((prev) => [{ episodeId, query }, ...prev]);

    // Clear input
    setIsQuerying(false);
  } catch (error) {
    console.error('Failed to submit query:', error);
    alert('Failed to submit question. Please try again.');
    setIsQuerying(false);
  }
};

// Add polling logic
useEffect(() => {
  if (pendingRuns.length === 0) return;

  const interval = setInterval(async () => {
    const updated: typeof pendingRuns = [];

    for (const run of pendingRuns) {
      try {
        const status = await getEpisodeStatus(run.episodeId);

        if (status.status === 'completed') {
          // Refetch notes to show the new result
          const data = await fetchTopicWithRelations(topicId);
          setNotes(data.notes);
          // Don't add back to updated array - it's done
        } else if (status.status === 'failed') {
          // Show error, don't add back
          console.error('Episode failed:', status.errorMessage);
        } else {
          // Still pending/running
          updated.push(run);
        }
      } catch (error) {
        console.error('Failed to check status:', error);
        updated.push(run); // Keep trying
      }
    }

    setPendingRuns(updated);
  }, 2000); // Poll every 2 seconds

  return () => clearInterval(interval);
}, [pendingRuns, topicId]);

// In the render, before notes.map()
{pendingRuns.map((run) => (
  <div key={run.episodeId} className="glass-card p-6 rounded-2xl border-purple-500/30">
    <div className="flex items-center gap-3 mb-2">
      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-400"></div>
      <h3 className="text-lg font-semibold text-white">Running: {run.query}</h3>
    </div>
    <p className="text-gray-400 text-sm">Researching your question...</p>
  </div>
))}
```

---

### 7. Optional: Pending Note Card Component

**File:** `components/topic/PendingNoteCard.tsx` (NEW)

```typescript
'use client';

export function PendingNoteCard({ query }: { query: string }) {
  return (
    <div className="glass-card p-6 rounded-2xl border-purple-500/30 animate-pulse">
      <div className="flex items-start gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-3">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-400"></div>
            <h3 className="text-lg font-semibold text-white">
              Running: {query.substring(0, 80)}{query.length > 80 ? '...' : ''}
            </h3>
          </div>
          <div className="space-y-2">
            <div className="h-4 bg-gray-700/50 rounded w-3/4"></div>
            <div className="h-4 bg-gray-700/50 rounded w-1/2"></div>
          </div>
          <div className="mt-4 flex items-center gap-2 text-xs text-purple-300">
            <span className="inline-block w-2 h-2 bg-purple-400 rounded-full animate-pulse"></span>
            <span>Researching...</span>
          </div>
        </div>
      </div>
    </div>
  );
}
```

---

## Implementation Steps

### Phase 1: Database & Repositories (30 min)
1. ✅ Add `status` and `errorMessage` fields to Episode model
2. ✅ Run Prisma migration
3. ✅ Update repository types
4. ✅ Add new repository functions (`updateEpisodeStatus`, `getPendingEpisodes`)

### Phase 2: Backend Logic (1 hour)
1. ✅ Create `src/lib/runResearch.ts` research execution function
2. ✅ Create POST `/api/topics/[id]/ask` endpoint
3. ✅ Create GET `/api/episodes/[episodeId]` endpoint
4. ✅ Create GET `/api/topics/[id]/notes` endpoint

### Phase 3: Frontend Integration (1 hour)
1. ✅ Create `lib/api/research.ts` API client
2. ✅ Update `app/topics/[id]/page.tsx` with:
   - `askQuestion` call in `handleQuery`
   - Pending runs state
   - Polling logic
   - Pending note cards in render
3. ✅ Create `PendingNoteCard` component (optional)

### Phase 4: Testing (30 min)
1. ✅ Seed database with test topic
2. ✅ Start dev server
3. ✅ Submit test query
4. ✅ Verify pending state shows
5. ✅ Verify completion and note creation
6. ✅ Test error handling

---

## Future Enhancements

### Add Inngest for Production
1. Install Inngest: `npm install inngest`
2. Create Inngest client
3. Create workflow in `src/workflows/researchQueryWorkflow.ts`
4. Replace direct `runResearch()` call with `inngest.send()`
5. Update polling to use Inngest status

### Evolution Integration
After each completed episode:
- Analyze metrics (save rate, follow-up count, etc.)
- Trigger evolution job if performance degrades
- Create new strategy version candidates

### Real-time Updates
Replace polling with:
- Server-Sent Events (SSE)
- WebSockets
- Supabase Realtime subscriptions

---

## Summary

**What exists:**
- Database schema (needs status field)
- Repositories (need status updates)
- Mastra research agent
- Frontend UI

**What needs to be built:**
- Database migration (add status field)
- 3 API endpoints (/ask, /episodes/:id, /notes)
- Research execution function
- Frontend polling logic
- Pending state UI

**Time estimate:** 3-4 hours for full implementation
**Complexity:** Medium (most pieces exist, just need wiring)

All code samples above are ready to copy-paste and adapt to your needs!
