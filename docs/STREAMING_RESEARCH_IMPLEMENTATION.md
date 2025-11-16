# Streaming Research Implementation Guide

## Overview

This guide extends the base research query implementation with **real-time streaming** so users can watch research progress live instead of waiting for completion.

**User Experience:**
- Submit question → Immediate feedback
- See live updates: "Searching web...", "Evaluating results...", "Extracting learnings..."
- Watch the note being written in real-time
- Much better than polling every 2 seconds

**Technical Approach:**
- Server-Sent Events (SSE) for progress updates
- AI SDK streaming for agent responses
- Real-time UI updates with React state

---

## Architecture Comparison

### Polling Approach (Original)
```
User submits → Episode created → Agent runs (hidden) → Poll every 2s → Show result
```

### Streaming Approach (Better UX)
```
User submits → Episode created → Agent streams progress → Live UI updates → Complete
```

---

## What Needs to Be Built

### 1. Database Schema (Same as Before)

Add `status` field to Episode model:

```prisma
model Episode {
  id                String   @id @default(cuid())
  topicId           String
  userId            String?
  strategyVersion   Int
  query             String

  status            String   @default("pending")  // "pending" | "searching" | "evaluating" | "summarizing" | "completed" | "failed"
  errorMessage      String?

  // ... rest of fields
}
```

**Migration:**
```bash
npx prisma migrate dev --name add_episode_status
```

---

### 2. Streaming Types

**File:** `lib/api/research.ts` (UPDATE)

```typescript
export type ResearchStreamEvent =
  | { type: 'status'; status: string; message: string }
  | { type: 'tool_call'; tool: string; args: Record<string, unknown> }
  | { type: 'tool_result'; tool: string; result: string }
  | { type: 'progress'; phase: string; step: number; total: number }
  | { type: 'partial'; content: string }
  | { type: 'note_created'; noteId: string; noteTitle: string }
  | { type: 'complete'; episodeId: string; noteId: string }
  | { type: 'error'; error: string };

export interface StreamingResearchState {
  status: string;
  phase: string;
  progress: { current: number; total: number };
  partialContent: string;
  toolCalls: Array<{ tool: string; args: any; result?: string }>;
  noteId?: string;
  error?: string;
}
```

---

### 3. Backend: Streaming Research Function

**File:** `src/lib/runResearchStreaming.ts` (NEW)

```typescript
import { researchAgent } from '@/mastra/agents/researchAgent';
import { createNote } from '@/repositories/notes';
import { updateEpisodeStatus, getEpisodeById } from '@/repositories/episodes';
import { getTopicById } from '@/repositories/topics';
import type { ResearchStreamEvent } from '@/lib/api/research';

/**
 * Run research with streaming progress updates
 */
export async function* runResearchStreaming(
  episodeId: string
): AsyncGenerator<ResearchStreamEvent> {
  try {
    // Load episode and topic
    const episode = await getEpisodeById(episodeId);
    if (!episode) {
      yield { type: 'error', error: 'Episode not found' };
      return;
    }

    const topic = await getTopicById(episode.topicId);
    if (!topic) {
      yield { type: 'error', error: 'Topic not found' };
      return;
    }

    yield {
      type: 'status',
      status: 'searching',
      message: 'Starting research...',
    };

    await updateEpisodeStatus(episodeId, 'running');

    // Stream research agent execution
    let fullContent = '';
    const toolCalls: Array<{ tool: string; args: any; result?: string }> = [];

    const stream = await researchAgent.stream([
      {
        role: 'user',
        content: `Research the following topic thoroughly: "${episode.query}"

Provide a comprehensive summary with:
1. Key findings
2. Important insights
3. Relevant sources

Format your response in clear, readable markdown.`,
      },
    ]);

    // Process the stream
    for await (const chunk of stream.fullStream) {
      if (chunk.type === 'text-delta') {
        fullContent += chunk.textDelta;
        yield {
          type: 'partial',
          content: chunk.textDelta,
        };
      } else if (chunk.type === 'tool-call') {
        const toolName = chunk.toolName;
        const args = chunk.args;

        toolCalls.push({ tool: toolName, args });

        yield {
          type: 'tool_call',
          tool: toolName,
          args,
        };

        // Update status based on tool
        if (toolName === 'linkupSearchTool') {
          yield {
            type: 'status',
            status: 'searching',
            message: `Searching: ${args.query || 'web'}`,
          };
        } else if (toolName === 'evaluateResultsBatchTool') {
          yield {
            type: 'status',
            status: 'evaluating',
            message: 'Evaluating search results...',
          };
        } else if (toolName === 'extractLearningsTool') {
          yield {
            type: 'status',
            status: 'extracting',
            message: 'Extracting key learnings...',
          };
        }
      } else if (chunk.type === 'tool-result') {
        const result = JSON.stringify(chunk.result);
        const lastCall = toolCalls[toolCalls.length - 1];
        if (lastCall) {
          lastCall.result = result;
        }

        yield {
          type: 'tool_result',
          tool: chunk.toolName,
          result,
        };
      }
    }

    // Create note with full content
    yield {
      type: 'status',
      status: 'saving',
      message: 'Creating note...',
    };

    const note = await createNote({
      topicId: episode.topicId,
      title: `Research: ${episode.query.substring(0, 60)}${episode.query.length > 60 ? '...' : ''}`,
      content: fullContent,
      type: 'research',
    });

    yield {
      type: 'note_created',
      noteId: note.id,
      noteTitle: note.title,
    };

    // Update episode as completed
    await updateEpisodeStatus(episodeId, 'completed', {
      resultNoteId: note.id,
      sourcesReturned: [],
      sourcesSaved: [],
    });

    yield {
      type: 'complete',
      episodeId: episode.id,
      noteId: note.id,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    await updateEpisodeStatus(episodeId, 'failed', {
      errorMessage,
    });

    yield {
      type: 'error',
      error: errorMessage,
    };
  }
}
```

---

### 4. API Route: Streaming Endpoint

**File:** `app/api/topics/[id]/ask/stream/route.ts` (NEW)

```typescript
import { NextRequest } from 'next/server';
import { createEpisode } from '@/repositories/episodes';
import { getTopicById } from '@/repositories/topics';
import { runResearchStreaming } from '@/lib/runResearchStreaming';

export const runtime = 'nodejs'; // Required for streaming
export const dynamic = 'force-dynamic'; // Disable caching

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: topicId } = await params;
    const body = await request.json();
    const { query } = body;

    if (!query || typeof query !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Query is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify topic exists
    const topic = await getTopicById(topicId);
    if (!topic) {
      return new Response(
        JSON.stringify({ error: 'Topic not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Create episode
    const episode = await createEpisode({
      topicId,
      query,
      strategyVersion: topic.activeStrategyVersion || 0,
      status: 'pending',
      sourcesReturned: [],
      sourcesSaved: [],
    });

    // Create Server-Sent Events stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Send episode ID first
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'episode_created', episodeId: episode.id })}\n\n`)
          );

          // Stream research progress
          for await (const event of runResearchStreaming(episode.id)) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
            );
          }

          controller.close();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'error', error: errorMessage })}\n\n`)
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Error in streaming endpoint:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to start research' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
```

---

### 5. Frontend: Streaming Hook

**File:** `hooks/useStreamingResearch.ts` (NEW)

```typescript
'use client';

import { useState, useCallback, useRef } from 'react';
import type { ResearchStreamEvent, StreamingResearchState } from '@/lib/api/research';

export function useStreamingResearch(topicId: string) {
  const [streamingState, setStreamingState] = useState<StreamingResearchState>({
    status: 'idle',
    phase: '',
    progress: { current: 0, total: 0 },
    partialContent: '',
    toolCalls: [],
  });

  const eventSourceRef = useRef<EventSource | null>(null);

  const startStreaming = useCallback(async (query: string) => {
    // Reset state
    setStreamingState({
      status: 'starting',
      phase: 'Initializing...',
      progress: { current: 0, total: 0 },
      partialContent: '',
      toolCalls: [],
    });

    try {
      // Create episode first
      const response = await fetch(`/api/topics/${topicId}/ask/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });

      if (!response.ok) {
        throw new Error('Failed to start research');
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      // Read the stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        // Decode and parse SSE events
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            try {
              const event: ResearchStreamEvent = JSON.parse(data);
              handleStreamEvent(event);
            } catch (e) {
              console.error('Failed to parse event:', e);
            }
          }
        }
      }
    } catch (error) {
      console.error('Streaming error:', error);
      setStreamingState((prev) => ({
        ...prev,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      }));
    }
  }, [topicId]);

  const handleStreamEvent = (event: ResearchStreamEvent) => {
    switch (event.type) {
      case 'episode_created':
        setStreamingState((prev) => ({
          ...prev,
          status: 'running',
        }));
        break;

      case 'status':
        setStreamingState((prev) => ({
          ...prev,
          status: event.status,
          phase: event.message,
        }));
        break;

      case 'tool_call':
        setStreamingState((prev) => ({
          ...prev,
          toolCalls: [...prev.toolCalls, { tool: event.tool, args: event.args }],
        }));
        break;

      case 'tool_result':
        setStreamingState((prev) => ({
          ...prev,
          toolCalls: prev.toolCalls.map((call, i) =>
            i === prev.toolCalls.length - 1
              ? { ...call, result: event.result }
              : call
          ),
        }));
        break;

      case 'partial':
        setStreamingState((prev) => ({
          ...prev,
          partialContent: prev.partialContent + event.content,
        }));
        break;

      case 'note_created':
        setStreamingState((prev) => ({
          ...prev,
          noteId: event.noteId,
        }));
        break;

      case 'complete':
        setStreamingState((prev) => ({
          ...prev,
          status: 'completed',
          noteId: event.noteId,
        }));
        break;

      case 'error':
        setStreamingState((prev) => ({
          ...prev,
          status: 'error',
          error: event.error,
        }));
        break;
    }
  };

  const stopStreaming = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  return {
    streamingState,
    startStreaming,
    stopStreaming,
    isStreaming: ['starting', 'running', 'searching', 'evaluating', 'extracting', 'saving'].includes(
      streamingState.status
    ),
  };
}
```

---

### 6. Frontend: Streaming Note Component

**File:** `components/topic/StreamingNoteCard.tsx` (NEW)

```typescript
'use client';

import { Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { StreamingResearchState } from '@/lib/api/research';

interface StreamingNoteCardProps {
  query: string;
  state: StreamingResearchState;
}

export function StreamingNoteCard({ query, state }: StreamingNoteCardProps) {
  return (
    <div className="glass-card p-6 rounded-2xl border-purple-500/30">
      {/* Header */}
      <div className="flex items-start gap-4 mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            {state.status !== 'completed' && state.status !== 'error' && (
              <Loader2 className="h-4 w-4 animate-spin text-purple-400" />
            )}
            <h3 className="text-lg font-semibold text-white">
              {query.substring(0, 80)}{query.length > 80 ? '...' : ''}
            </h3>
          </div>

          {/* Status Badge */}
          <div className="flex items-center gap-2 text-xs">
            <span
              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full ${
                state.status === 'completed'
                  ? 'bg-green-500/20 text-green-300'
                  : state.status === 'error'
                  ? 'bg-red-500/20 text-red-300'
                  : 'bg-purple-500/20 text-purple-300'
              }`}
            >
              {state.status === 'completed' && '✓'}
              {state.status === 'error' && '✗'}
              {!['completed', 'error'].includes(state.status) && (
                <span className="inline-block w-1.5 h-1.5 bg-current rounded-full animate-pulse"></span>
              )}
              {state.phase || state.status}
            </span>
          </div>
        </div>
      </div>

      {/* Tool Calls */}
      {state.toolCalls.length > 0 && (
        <div className="mb-4 space-y-2">
          {state.toolCalls.slice(-3).map((call, i) => (
            <div key={i} className="text-xs text-gray-400 flex items-center gap-2">
              <span className="text-purple-400">→</span>
              <span className="font-mono">{call.tool}</span>
              {call.result && <span className="text-green-400">✓</span>}
            </div>
          ))}
        </div>
      )}

      {/* Partial Content */}
      {state.partialContent && (
        <div className="prose prose-invert prose-sm max-w-none">
          <ReactMarkdown>{state.partialContent}</ReactMarkdown>
          {state.status !== 'completed' && (
            <span className="inline-block w-2 h-4 bg-purple-400 animate-pulse ml-1"></span>
          )}
        </div>
      )}

      {/* Error */}
      {state.error && (
        <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <p className="text-red-300 text-sm">{state.error}</p>
        </div>
      )}

      {/* Progress indicator */}
      {state.status !== 'completed' && state.status !== 'error' && !state.partialContent && (
        <div className="space-y-2 animate-pulse">
          <div className="h-4 bg-gray-700/50 rounded w-3/4"></div>
          <div className="h-4 bg-gray-700/50 rounded w-1/2"></div>
        </div>
      )}
    </div>
  );
}
```

---

### 7. Frontend: Integration

**File:** `app/topics/[id]/page.tsx` (UPDATE)

```typescript
'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { fetchTopicWithRelations, type Topic, type Note } from '@/lib/api/topics';
import { NoteCard } from '@/components/topic/NoteCard';
import { StreamingNoteCard } from '@/components/topic/StreamingNoteCard';
import { QueryInput } from '@/components/topic/QueryInput';
import { AgentBrainPanel } from '@/components/agent/AgentBrainPanel';
import { useStreamingResearch } from '@/hooks/useStreamingResearch';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function TopicWorkspacePage() {
  const params = useParams();
  const topicId = params.id as string;

  const [topic, setTopic] = useState<Topic | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [watchEnabled, setWatchEnabled] = useState(false);

  const { streamingState, startStreaming, isStreaming } = useStreamingResearch(topicId);
  const [currentQuery, setCurrentQuery] = useState('');

  // Load topic
  useEffect(() => {
    async function loadTopic() {
      try {
        setLoading(true);
        const data = await fetchTopicWithRelations(topicId);
        setTopic(data);
        setNotes(data.notes);
        setWatchEnabled(data.watchEnabled);
        setError(null);
      } catch (err) {
        console.error('Error loading topic:', err);
        setError('Failed to load topic');
      } finally {
        setLoading(false);
      }
    }

    loadTopic();
  }, [topicId]);

  // Refetch notes when streaming completes
  useEffect(() => {
    if (streamingState.status === 'completed' && streamingState.noteId) {
      // Refetch topic to get the new note
      fetchTopicWithRelations(topicId).then((data) => {
        setNotes(data.notes);
      });
    }
  }, [streamingState.status, streamingState.noteId, topicId]);

  const handleQuery = async (query: string) => {
    setCurrentQuery(query);
    await startStreaming(query);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="glass-card p-12 rounded-2xl">
          <p className="text-gray-300">Loading topic...</p>
        </div>
      </div>
    );
  }

  if (error || !topic) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="glass-card p-12 rounded-2xl border-red-500/30">
          <p className="text-red-300">{error || 'Topic not found'}</p>
          <Link href="/topics" className="text-purple-400 hover:text-purple-300 mt-4 inline-block">
            ← Back to topics
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative">
      {/* Header */}
      <header className="fixed top-0 left-0 w-full z-50 glass-header">
        <div className="container mx-auto max-w-7xl px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <Link href="/topics" className="text-gray-400 hover:text-white transition-colors">
                  <ArrowLeft className="w-5 h-5" />
                </Link>
                <h1 className="text-2xl font-bold text-white">{topic.title}</h1>
                {watchEnabled && (
                  <Badge className="bg-purple-900/50 text-purple-200 border-purple-700/50 text-xs">
                    Watching
                  </Badge>
                )}
              </div>
              {topic.description && (
                <p className="text-sm text-gray-300 ml-8">{topic.description}</p>
              )}
              <div className="flex items-center gap-4 text-xs text-gray-400 ml-8 mt-2">
                <span>{notes.length} notes</span>
                <span>•</span>
                <span>{topic.strategies.length} strategies</span>
                <span>•</span>
                <span>Active: v{topic.activeStrategyVersion}</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Switch
                  id="watch-mode"
                  checked={watchEnabled}
                  onCheckedChange={setWatchEnabled}
                />
                <Label htmlFor="watch-mode" className="text-gray-300 text-sm cursor-pointer">
                  Watch updates
                </Label>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Query Input - Fixed */}
      <div className="fixed top-[120px] left-0 right-0 z-40 glass-header border-b border-white/5">
        <div className="container mx-auto max-w-7xl px-6 py-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7">
              <QueryInput onSubmit={handleQuery} isLoading={isStreaming} />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content - 2 Column Layout */}
      <div className="container mx-auto px-6 pb-12 max-w-7xl relative z-0 pt-[350px]">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Center Column - Research Stream */}
          <div className="lg:col-span-7 space-y-4">
            {/* Streaming Note (if active) */}
            {isStreaming && currentQuery && (
              <StreamingNoteCard query={currentQuery} state={streamingState} />
            )}

            {/* Regular Notes */}
            {notes.length === 0 && !isStreaming ? (
              <div className="glass-card p-12 text-center rounded-2xl">
                <p className="text-gray-300 text-lg mb-2">No research yet</p>
                <p className="text-gray-500 text-sm">
                  Ask your first question to start training this research agent
                </p>
              </div>
            ) : (
              notes.map((note) => <NoteCard key={note.id} note={note} />)
            )}
          </div>

          {/* Right Column - Agent Brain */}
          <div className="lg:col-span-5">
            <div className="lg:sticky lg:top-[330px]">
              <AgentBrainPanel topic={topic} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

---

### 8. Install Dependencies

```bash
npm install react-markdown
```

---

## Implementation Steps

### Phase 1: Database (10 min)
```bash
# Update Episode model in prisma/schema.prisma
npx prisma migrate dev --name add_episode_status
npx prisma generate
```

### Phase 2: Backend Streaming (1 hour)
1. ✅ Create `src/lib/runResearchStreaming.ts`
2. ✅ Create `app/api/topics/[id]/ask/stream/route.ts`
3. ✅ Test with curl: `curl -N http://localhost:3000/api/topics/{id}/ask/stream -d '{"query":"test"}'`

### Phase 3: Frontend Streaming (1 hour)
1. ✅ Create `hooks/useStreamingResearch.ts`
2. ✅ Create `components/topic/StreamingNoteCard.tsx`
3. ✅ Update `app/topics/[id]/page.tsx`
4. ✅ Install `react-markdown`

### Phase 4: Testing (30 min)
1. ✅ Submit test query
2. ✅ Verify real-time status updates
3. ✅ Watch partial content stream
4. ✅ See tool calls appear
5. ✅ Confirm note creation
6. ✅ Test error handling

---

## Benefits Over Polling

| Feature | Polling | Streaming |
|---------|---------|-----------|
| Latency | 2s average | < 100ms |
| Server Load | Higher (constant requests) | Lower (single connection) |
| UX | Choppy updates | Smooth real-time |
| User Feedback | Minimal | Rich progress info |
| Tool Visibility | Hidden | Visible as they run |
| Content Preview | None | Live typing effect |

---

## Advanced Enhancements

### 1. Add Progress Bar
```typescript
// In StreamingNoteCard
{state.progress.total > 0 && (
  <div className="w-full bg-gray-700 rounded-full h-1 mb-4">
    <div
      className="bg-purple-500 h-1 rounded-full transition-all"
      style={{ width: `${(state.progress.current / state.progress.total) * 100}%` }}
    />
  </div>
)}
```

### 2. Show Search Queries
```typescript
// Track queries in streamingState
queries: string[];

// Display them
{state.queries.map((q, i) => (
  <div key={i} className="text-xs text-gray-400">
    🔍 {q}
  </div>
))}
```

### 3. Syntax Highlighting for Code
```typescript
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';

// In ReactMarkdown
components={{
  code({ node, inline, className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || '');
    return !inline && match ? (
      <SyntaxHighlighter language={match[1]} {...props}>
        {String(children).replace(/\n$/, '')}
      </SyntaxHighlighter>
    ) : (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
}}
```

---

## Debugging Tips

### Stream not working?
```typescript
// Check browser console for:
console.log('Stream state:', streamingState);

// Check server logs for:
console.log('Sending event:', event);
```

### Events not parsing?
```typescript
// Verify SSE format:
data: {"type":"status","message":"test"}\n\n
// NOT:
{"type":"status","message":"test"}
```

### Stream cuts off?
```typescript
// Check Next.js timeout config
export const maxDuration = 300; // 5 minutes
```

---

## Summary

**Streaming adds:**
- ✅ Real-time progress updates
- ✅ Tool call visibility
- ✅ Live content generation
- ✅ Better user experience
- ✅ Lower server load

**Time to implement:** 2-3 hours
**Complexity:** Medium (SSE + React state management)

All code is ready to copy-paste and customize!
