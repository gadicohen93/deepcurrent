# Streaming Intermediate Results - Enhanced Implementation

## Overview

This guide extends the streaming implementation to show **all intermediate research steps** in real-time:

1. 🔍 Search queries being executed
2. 📄 Search results as they're found
3. ✅ Result evaluations (relevant/not relevant)
4. 💡 Learnings extracted from each result
5. ❓ Follow-up questions generated
6. 📝 Final summary being written

**User sees the entire research process unfold live** - just like watching an expert researcher work.

---

## Enhanced Event Types

**File:** `lib/api/research.ts` (UPDATE)

```typescript
export type ResearchStreamEvent =
  | { type: 'episode_created'; episodeId: string }
  | { type: 'status'; status: string; message: string }

  // Phase events
  | { type: 'phase_start'; phase: 'initial_research' | 'follow_up_research' | 'final_summary'; description: string }
  | { type: 'phase_complete'; phase: string; summary: string }

  // Search events
  | { type: 'search_start'; query: string; queryNumber: number; totalQueries: number }
  | { type: 'search_result'; result: SearchResult; isRelevant?: boolean }
  | { type: 'search_complete'; query: string; totalResults: number; relevantResults: number }

  // Evaluation events
  | { type: 'evaluation_start'; resultCount: number }
  | { type: 'evaluation_result'; url: string; title: string; isRelevant: boolean; reason: string }
  | { type: 'evaluation_complete'; totalEvaluated: number; relevant: number; notRelevant: number }

  // Learning events
  | { type: 'learning_extracted'; learning: Learning; sourceUrl: string }
  | { type: 'follow_up_questions'; questions: string[]; source: string }

  // Tool events
  | { type: 'tool_call'; tool: string; args: Record<string, unknown>; timestamp: string }
  | { type: 'tool_result'; tool: string; result: any; duration: number }

  // Content events
  | { type: 'partial_summary'; content: string }
  | { type: 'note_created'; noteId: string; noteTitle: string }

  // Completion
  | { type: 'complete'; episodeId: string; noteId: string; stats: ResearchStats }
  | { type: 'error'; error: string };

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  relevance?: number;
}

export interface Learning {
  learning: string;
  followUpQuestions: string[];
  source: string;
  confidence?: number;
}

export interface ResearchStats {
  totalQueries: number;
  totalResults: number;
  relevantResults: number;
  learningsExtracted: number;
  followUpQuestions: number;
  duration: number;
}

export interface StreamingResearchState {
  status: string;
  phase: string;
  currentQuery?: string;
  progress: { current: number; total: number };

  // Intermediate results
  searchQueries: Array<{ query: string; status: 'pending' | 'searching' | 'complete' }>;
  searchResults: SearchResult[];
  evaluations: Array<{ url: string; title: string; isRelevant: boolean; reason: string }>;
  learnings: Learning[];
  followUpQuestions: string[];

  // Tool tracking
  toolCalls: Array<{ tool: string; args: any; result?: any; duration?: number; timestamp: string }>;

  // Final content
  partialContent: string;
  noteId?: string;
  error?: string;

  // Stats
  stats: ResearchStats;
}
```

---

## Enhanced Backend: Streaming with Intermediate Results

**File:** `src/lib/runResearchStreaming.ts` (REPLACE)

```typescript
import { researchAgent } from '@/mastra/agents/researchAgent';
import { createNote } from '@/repositories/notes';
import { updateEpisodeStatus, getEpisodeById } from '@/repositories/episodes';
import { getTopicById } from '@/repositories/topics';
import type { ResearchStreamEvent, SearchResult, Learning } from '@/lib/api/research';

/**
 * Run research with full intermediate results streaming
 */
export async function* runResearchStreaming(
  episodeId: string
): AsyncGenerator<ResearchStreamEvent> {
  const startTime = Date.now();
  const stats = {
    totalQueries: 0,
    totalResults: 0,
    relevantResults: 0,
    learningsExtracted: 0,
    followUpQuestions: 0,
    duration: 0,
  };

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

    yield { type: 'episode_created', episodeId: episode.id };

    yield {
      type: 'status',
      status: 'initializing',
      message: 'Starting research workflow...',
    };

    await updateEpisodeStatus(episodeId, 'running');

    // Phase 1: Initial Research
    yield {
      type: 'phase_start',
      phase: 'initial_research',
      description: 'Conducting initial research with 2-3 focused queries',
    };

    const allLearnings: Learning[] = [];
    const allSearchResults: SearchResult[] = [];
    let fullContent = '';

    // Stream the research agent
    const stream = await researchAgent.stream([
      {
        role: 'user',
        content: `Research the following topic thoroughly using the two-phase process: "${episode.query}".

Phase 1: Break down into 2-3 specific search queries, search, evaluate, and extract learnings
Phase 2: Search follow-up questions from Phase 1 learnings, then STOP

Return comprehensive findings with all intermediate steps visible.`,
      },
    ]);

    let currentToolCall: { tool: string; args: any; startTime: number; timestamp: string } | null = null;

    // Process the stream
    for await (const chunk of stream.fullStream) {
      if (chunk.type === 'text-delta') {
        fullContent += chunk.textDelta;
        yield {
          type: 'partial_summary',
          content: chunk.textDelta,
        };
      }

      else if (chunk.type === 'tool-call') {
        const toolName = chunk.toolName;
        const args = chunk.args as any;
        const timestamp = new Date().toISOString();

        currentToolCall = {
          tool: toolName,
          args,
          startTime: Date.now(),
          timestamp,
        };

        yield {
          type: 'tool_call',
          tool: toolName,
          args,
          timestamp,
        };

        // Handle specific tool calls with rich events
        if (toolName === 'linkupSearchTool') {
          stats.totalQueries++;
          yield {
            type: 'search_start',
            query: args.query || 'unknown query',
            queryNumber: stats.totalQueries,
            totalQueries: stats.totalQueries,
          };

          yield {
            type: 'status',
            status: 'searching',
            message: `Searching: "${args.query}"`,
          };
        }

        else if (toolName === 'evaluateResultsBatchTool') {
          const resultCount = args.results?.length || 0;
          yield {
            type: 'evaluation_start',
            resultCount,
          };

          yield {
            type: 'status',
            status: 'evaluating',
            message: `Evaluating ${resultCount} search results...`,
          };
        }

        else if (toolName === 'extractLearningsTool') {
          yield {
            type: 'status',
            status: 'extracting',
            message: 'Extracting key learnings and follow-up questions...',
          };
        }
      }

      else if (chunk.type === 'tool-result') {
        const duration = currentToolCall ? Date.now() - currentToolCall.startTime : 0;
        const result = chunk.result as any;

        yield {
          type: 'tool_result',
          tool: chunk.toolName,
          result,
          duration,
        };

        // Parse and emit intermediate results
        if (chunk.toolName === 'linkupSearchTool' && result?.results) {
          const results = result.results;
          stats.totalResults += results.length;

          // Emit each search result
          for (const res of results) {
            const searchResult: SearchResult = {
              url: res.url,
              title: res.title,
              snippet: res.content?.substring(0, 200) || '',
            };
            allSearchResults.push(searchResult);

            yield {
              type: 'search_result',
              result: searchResult,
            };
          }

          yield {
            type: 'search_complete',
            query: currentToolCall?.args?.query || 'unknown',
            totalResults: results.length,
            relevantResults: 0, // Will be updated after evaluation
          };
        }

        else if (chunk.toolName === 'evaluateResultsBatchTool' && result?.evaluations) {
          const evaluations = result.evaluations;
          let relevant = 0;
          let notRelevant = 0;

          // Emit each evaluation
          for (const eval of evaluations) {
            const isRelevant = eval.isRelevant || eval.relevant || false;
            if (isRelevant) {
              relevant++;
              stats.relevantResults++;
            } else {
              notRelevant++;
            }

            yield {
              type: 'evaluation_result',
              url: eval.url,
              title: eval.title,
              isRelevant,
              reason: eval.reason || eval.reasoning || 'No reason provided',
            };
          }

          yield {
            type: 'evaluation_complete',
            totalEvaluated: evaluations.length,
            relevant,
            notRelevant,
          };
        }

        else if (chunk.toolName === 'extractLearningsTool' && result?.learnings) {
          const learnings = Array.isArray(result.learnings) ? result.learnings : [result.learnings];

          for (const learning of learnings) {
            const learningObj: Learning = {
              learning: learning.learning || learning.text || '',
              followUpQuestions: learning.followUpQuestions || [],
              source: learning.source || 'unknown',
            };

            allLearnings.push(learningObj);
            stats.learningsExtracted++;
            stats.followUpQuestions += learningObj.followUpQuestions.length;

            yield {
              type: 'learning_extracted',
              learning: learningObj,
              sourceUrl: learningObj.source,
            };

            if (learningObj.followUpQuestions.length > 0) {
              yield {
                type: 'follow_up_questions',
                questions: learningObj.followUpQuestions,
                source: learningObj.source,
              };
            }
          }
        }

        currentToolCall = null;
      }
    }

    // Phase complete
    yield {
      type: 'phase_complete',
      phase: 'initial_research',
      summary: `Found ${stats.totalResults} results, ${stats.relevantResults} relevant, extracted ${stats.learningsExtracted} learnings`,
    };

    // Create note
    yield {
      type: 'status',
      status: 'saving',
      message: 'Creating research note...',
    };

    const note = await createNote({
      topicId: episode.topicId,
      title: `Research: ${episode.query.substring(0, 60)}${episode.query.length > 60 ? '...' : ''}`,
      content: fullContent || '# Research Results\n\nNo results generated.',
      type: 'research',
    });

    yield {
      type: 'note_created',
      noteId: note.id,
      noteTitle: note.title,
    };

    // Update episode
    await updateEpisodeStatus(episodeId, 'completed', {
      resultNoteId: note.id,
      sourcesReturned: allSearchResults.map(r => ({ url: r.url, title: r.title })),
      sourcesSaved: allSearchResults.filter((_, i) => i < stats.relevantResults).map(r => ({ url: r.url, title: r.title })),
    });

    stats.duration = Date.now() - startTime;

    yield {
      type: 'complete',
      episodeId: episode.id,
      noteId: note.id,
      stats,
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

## Enhanced Frontend: Display Intermediate Results

**File:** `components/topic/StreamingNoteCard.tsx` (REPLACE)

```typescript
'use client';

import { Loader2, Search, CheckCircle, XCircle, Lightbulb, HelpCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { StreamingResearchState, SearchResult, Learning } from '@/lib/api/research';

interface StreamingNoteCardProps {
  query: string;
  state: StreamingResearchState;
}

export function StreamingNoteCard({ query, state }: StreamingNoteCardProps) {
  return (
    <div className="glass-card p-6 rounded-2xl border-purple-500/30 space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            {!['completed', 'error'].includes(state.status) && (
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

            {/* Stats */}
            {state.stats.totalQueries > 0 && (
              <span className="text-gray-400">
                {state.stats.totalQueries} queries • {state.stats.relevantResults}/{state.stats.totalResults} relevant
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Search Queries */}
      {state.searchQueries.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
            <Search className="w-4 h-4" />
            Search Queries
          </h4>
          <div className="space-y-1">
            {state.searchQueries.map((q, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="text-purple-400">→</span>
                <span className="text-gray-300">{q.query}</span>
                {q.status === 'searching' && (
                  <Loader2 className="w-3 h-3 animate-spin text-purple-400" />
                )}
                {q.status === 'complete' && (
                  <CheckCircle className="w-3 h-3 text-green-400" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search Results */}
      {state.searchResults.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-gray-300">
            Search Results ({state.searchResults.length})
          </h4>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {state.searchResults.slice(0, 10).map((result, i) => {
              const evaluation = state.evaluations.find(e => e.url === result.url);
              return (
                <div
                  key={i}
                  className={`p-3 rounded-lg text-sm ${
                    evaluation?.isRelevant
                      ? 'bg-green-500/10 border border-green-500/30'
                      : evaluation
                      ? 'bg-gray-500/10 border border-gray-500/30'
                      : 'bg-gray-700/20 border border-gray-700/30'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {evaluation?.isRelevant ? (
                      <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                    ) : evaluation ? (
                      <XCircle className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                    ) : (
                      <div className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <a
                        href={result.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-purple-300 hover:text-purple-200 font-medium truncate block"
                      >
                        {result.title}
                      </a>
                      <p className="text-gray-400 text-xs mt-1 line-clamp-2">
                        {result.snippet}
                      </p>
                      {evaluation && (
                        <p className="text-gray-500 text-xs mt-1 italic">
                          {evaluation.reason}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {state.searchResults.length > 10 && (
              <p className="text-xs text-gray-500 text-center">
                +{state.searchResults.length - 10} more results
              </p>
            )}
          </div>
        </div>
      )}

      {/* Learnings */}
      {state.learnings.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
            <Lightbulb className="w-4 h-4" />
            Key Learnings ({state.learnings.length})
          </h4>
          <div className="space-y-3">
            {state.learnings.map((learning, i) => (
              <div key={i} className="p-3 bg-purple-500/10 border border-purple-500/30 rounded-lg">
                <p className="text-sm text-gray-200">{learning.learning}</p>
                {learning.followUpQuestions.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <p className="text-xs text-purple-300 flex items-center gap-1">
                      <HelpCircle className="w-3 h-3" />
                      Follow-up questions:
                    </p>
                    <ul className="text-xs text-gray-400 space-y-0.5 ml-4">
                      {learning.followUpQuestions.map((q, qi) => (
                        <li key={qi}>• {q}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-xs text-gray-500 mt-2">
                  Source: {learning.source}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tool Calls (condensed) */}
      {state.toolCalls.length > 0 && (
        <details className="text-xs">
          <summary className="text-gray-400 cursor-pointer hover:text-gray-300">
            Tool Calls ({state.toolCalls.length})
          </summary>
          <div className="mt-2 space-y-1 ml-4">
            {state.toolCalls.map((call, i) => (
              <div key={i} className="text-gray-500 flex items-center gap-2">
                <span className="text-purple-400">→</span>
                <span className="font-mono">{call.tool}</span>
                {call.duration && (
                  <span className="text-gray-600">({call.duration}ms)</span>
                )}
                {call.result && <CheckCircle className="w-3 h-3 text-green-400" />}
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Partial Summary Content */}
      {state.partialContent && (
        <div className="border-t border-gray-700 pt-4">
          <h4 className="text-sm font-semibold text-gray-300 mb-3">Research Summary</h4>
          <div className="prose prose-invert prose-sm max-w-none">
            <ReactMarkdown>{state.partialContent}</ReactMarkdown>
            {!['completed', 'error'].includes(state.status) && (
              <span className="inline-block w-2 h-4 bg-purple-400 animate-pulse ml-1"></span>
            )}
          </div>
        </div>
      )}

      {/* Error */}
      {state.error && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <p className="text-red-300 text-sm">{state.error}</p>
        </div>
      )}

      {/* Completion Stats */}
      {state.status === 'completed' && state.stats.duration > 0 && (
        <div className="border-t border-gray-700 pt-4">
          <div className="grid grid-cols-2 gap-4 text-xs text-gray-400">
            <div>
              <span className="text-gray-500">Duration:</span>{' '}
              {(state.stats.duration / 1000).toFixed(1)}s
            </div>
            <div>
              <span className="text-gray-500">Learnings:</span>{' '}
              {state.stats.learningsExtracted}
            </div>
            <div>
              <span className="text-gray-500">Queries:</span>{' '}
              {state.stats.totalQueries}
            </div>
            <div>
              <span className="text-gray-500">Follow-ups:</span>{' '}
              {state.stats.followUpQuestions}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

---

## Enhanced Hook: Handle All Event Types

**File:** `hooks/useStreamingResearch.ts` (UPDATE)

```typescript
// Add to handleStreamEvent function

const handleStreamEvent = (event: ResearchStreamEvent) => {
  switch (event.type) {
    case 'episode_created':
      // Already handled
      break;

    case 'phase_start':
      setStreamingState((prev) => ({
        ...prev,
        phase: event.description,
      }));
      break;

    case 'search_start':
      setStreamingState((prev) => ({
        ...prev,
        currentQuery: event.query,
        searchQueries: [
          ...prev.searchQueries,
          { query: event.query, status: 'searching' },
        ],
        progress: { current: event.queryNumber, total: event.totalQueries },
      }));
      break;

    case 'search_result':
      setStreamingState((prev) => ({
        ...prev,
        searchResults: [...prev.searchResults, event.result],
      }));
      break;

    case 'search_complete':
      setStreamingState((prev) => ({
        ...prev,
        searchQueries: prev.searchQueries.map((q) =>
          q.query === event.query ? { ...q, status: 'complete' } : q
        ),
      }));
      break;

    case 'evaluation_result':
      setStreamingState((prev) => ({
        ...prev,
        evaluations: [
          ...prev.evaluations,
          {
            url: event.url,
            title: event.title,
            isRelevant: event.isRelevant,
            reason: event.reason,
          },
        ],
      }));
      break;

    case 'learning_extracted':
      setStreamingState((prev) => ({
        ...prev,
        learnings: [...prev.learnings, event.learning],
        stats: {
          ...prev.stats,
          learningsExtracted: prev.stats.learningsExtracted + 1,
        },
      }));
      break;

    case 'follow_up_questions':
      setStreamingState((prev) => ({
        ...prev,
        followUpQuestions: [...prev.followUpQuestions, ...event.questions],
        stats: {
          ...prev.stats,
          followUpQuestions: prev.stats.followUpQuestions + event.questions.length,
        },
      }));
      break;

    case 'tool_call':
      setStreamingState((prev) => ({
        ...prev,
        toolCalls: [
          ...prev.toolCalls,
          { tool: event.tool, args: event.args, timestamp: event.timestamp },
        ],
      }));
      break;

    case 'tool_result':
      setStreamingState((prev) => ({
        ...prev,
        toolCalls: prev.toolCalls.map((call, i) =>
          i === prev.toolCalls.length - 1
            ? { ...call, result: event.result, duration: event.duration }
            : call
        ),
      }));
      break;

    case 'partial_summary':
      setStreamingState((prev) => ({
        ...prev,
        partialContent: prev.partialContent + event.content,
      }));
      break;

    case 'complete':
      setStreamingState((prev) => ({
        ...prev,
        status: 'completed',
        noteId: event.noteId,
        stats: event.stats,
      }));
      break;

    // ... existing cases
  }
};
```

---

## What Users See (Example Flow)

### 1. Initial Search
```
🔍 Search Queries
  → "self-evolving AI agents overview"  ✓
  → "autonomous agent improvement mechanisms"  [spinner]

Search Results (5)
  ✓ "Self-Evolving AI: A New Paradigm" - arxiv.org
     Highly relevant: Discusses agent evolution mechanisms
  ✓ "Autonomous Improvement in AI Systems" - mit.edu
     Relevant: Covers self-modification techniques
  ✗ "Basic AI Tutorial" - example.com
     Not relevant: Too basic for this query
  ...
```

### 2. Evaluations
```
Evaluating 15 search results...
  ✓ 8 relevant
  ✗ 7 not relevant
```

### 3. Learnings
```
💡 Key Learnings (3)

"Self-evolving AI agents use meta-learning to improve their own
 decision-making strategies over time."

 ❓ Follow-up questions:
  • What meta-learning algorithms are most effective?
  • How do agents measure their own performance?

 Source: arxiv.org/paper/...

[More learnings...]
```

### 4. Final Summary
```
Research Summary

# Self-Evolving AI Agents

Self-evolving AI agents represent a paradigm shift...
[Content streams in character by character]
```

### 5. Completion Stats
```
Duration: 12.3s
Learnings: 8
Queries: 5
Follow-ups: 12
```

---

## Benefits of Showing Intermediate Results

### 1. Transparency
Users see **exactly** what the system is doing:
- Which queries are being searched
- What results are found
- Why results are kept or discarded
- What insights are extracted

### 2. Trust
Users can **verify quality**:
- See if searches are relevant
- Check if evaluations make sense
- Validate learnings
- Trust the final summary

### 3. Engagement
Users are **actively watching**:
- Something new appears every second
- Research feels alive
- Users stay on the page
- Better perception of speed

### 4. Debugging
Developers can **see failures**:
- Which search failed
- Which evaluation was wrong
- Where learnings are missing
- Exact tool call that broke

---

## Summary

**Enhanced streaming now shows:**
- ✅ Every search query
- ✅ Every search result
- ✅ Relevance evaluations with reasons
- ✅ Extracted learnings
- ✅ Follow-up questions
- ✅ Tool call sequence
- ✅ Partial summary as it's written
- ✅ Final stats and timing

**Implementation:** Same 2-3 hours, just enhanced event handling

**User Experience:** Complete transparency - watch the AI research in real-time!

All code is ready to implement. Would you like me to build this now?
