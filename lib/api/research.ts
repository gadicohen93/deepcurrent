/**
 * Research API Types
 * 
 * Type definitions for research streaming functionality
 */

export type ResearchStreamEvent =
  | { type: 'episode_created'; episodeId: string }
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

