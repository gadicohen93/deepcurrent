/**
 * Research API Types
 * 
 * Type definitions for research streaming functionality
 */

export type ResearchStreamEvent =
  | { type: 'episode_created'; episodeId: string }
  | { type: 'status'; status: string; message: string; details?: Record<string, unknown> }
  | { type: 'tool_call'; tool: string; args: Record<string, unknown> }
  | { type: 'tool_result'; tool: string; result: string; details?: Record<string, unknown> }
  | { type: 'search_results'; query: string; count: number; urls: string[] }
  | { type: 'evaluation_results'; evaluated: number; relevant: number; results: Array<{ url: string; isRelevant: boolean; reason: string }> }
  | { type: 'learning_extracted'; learning: string; followUpQuestions: string[] }
  | { type: 'strategy_evolved'; fromVersion: number; toVersion: number; reason: string; changes: Record<string, unknown> }
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
  searchResults?: Array<{ query: string; count: number; urls: string[] }>;
  evaluations?: Array<{ evaluated: number; relevant: number; results: Array<{ url: string; isRelevant: boolean; reason: string }> }>;
  learnings?: Array<{ learning: string; followUpQuestions: string[] }>;
  strategyEvolution?: { fromVersion: number; toVersion: number; reason: string };
  noteId?: string;
  error?: string;
}

