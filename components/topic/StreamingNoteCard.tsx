/**
 * Streaming Note Card Component
 * 
 * Displays real-time research progress with streaming content
 */

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

