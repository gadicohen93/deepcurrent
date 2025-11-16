/**
 * Streaming Note Card Component
 * 
 * Displays real-time research progress with streaming content and detailed tool insights
 */

'use client';

import { Loader2, Search, CheckCircle, XCircle, Lightbulb, ExternalLink } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { StreamingResearchState } from '@/lib/api/research';

interface StreamingNoteCardProps {
  query: string;
  state: StreamingResearchState;
}

export function StreamingNoteCard({ query, state }: StreamingNoteCardProps) {
  return (
    <div className="glass-card p-6 rounded-2xl border-purple-500/30 space-y-4">
      {/* Header */}
      <div className="flex items-start gap-4">
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

      {/* Search Results Detail */}
      {(state.searchResults?.length ?? 0) > 0 && (
        <div className="space-y-2">
          {state.searchResults?.map((search, i) => (
            <div key={i} className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <Search className="h-4 w-4 text-blue-400" />
                <span className="text-sm font-medium text-blue-300">
                  Search: {search.query}
                </span>
                <span className="text-xs text-blue-400 ml-auto">
                  {search.count} results
                </span>
              </div>
              {(search.urls?.length ?? 0) > 0 && (
                <div className="space-y-1 mt-2">
                  {search.urls.slice(0, 3).map((url, j) => (
                    <a
                      key={j}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 truncate"
                    >
                      <ExternalLink className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate">{url}</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Evaluation Results Detail */}
      {(state.evaluations?.length ?? 0) > 0 && (
        <div className="space-y-2">
          {state.evaluations?.map((evaluation, i) => (
            <div key={i} className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-medium text-yellow-300">
                  ⚖️ Evaluated {evaluation.evaluated} results
                </span>
                <span className="text-xs text-green-400 ml-auto">
                  {evaluation.relevant} relevant
                </span>
              </div>
              {(evaluation.results?.length ?? 0) > 0 && (
                <div className="space-y-2 mt-2">
                  {evaluation.results.map((result, j) => (
                    <div
                      key={j}
                      className="flex items-start gap-2 text-xs"
                    >
                      {result.isRelevant ? (
                        <CheckCircle className="h-3 w-3 text-green-400 flex-shrink-0 mt-0.5" />
                      ) : (
                        <XCircle className="h-3 w-3 text-red-400 flex-shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-gray-300 truncate">{result.url}</div>
                        <div className="text-gray-500 text-[10px] mt-0.5">{result.reason}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Learning Extracted Detail */}
      {(state.learnings?.length ?? 0) > 0 && (
        <div className="space-y-2">
          {state.learnings?.map((learning, i) => (
            <div key={i} className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3">
              <div className="flex items-start gap-2 mb-2">
                <Lightbulb className="h-4 w-4 text-purple-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm text-purple-300 mb-2">{learning.learning}</p>
                  {(learning.followUpQuestions?.length ?? 0) > 0 && (
                    <div className="space-y-1">
                      {learning.followUpQuestions.map((q, j) => (
                        <div key={j} className="text-xs text-purple-400 flex items-start gap-1">
                          <span className="flex-shrink-0">→</span>
                          <span>{q}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Strategy Evolution Alert */}
      {state.strategyEvolution && (
        <div className="bg-gradient-to-r from-purple-500/20 to-pink-500/20 border border-purple-500/40 rounded-lg p-4 animate-in slide-in-from-top-2">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0">
              <div className="h-8 w-8 rounded-full bg-purple-500/30 flex items-center justify-center">
                <span className="text-lg">🧬</span>
              </div>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold text-purple-300">Strategy Evolved!</span>
                <span className="text-xs text-gray-400">
                  v{state.strategyEvolution.fromVersion} → v{state.strategyEvolution.toVersion}
                </span>
              </div>
              <p className="text-sm text-gray-300 leading-relaxed">
                {state.strategyEvolution.reason}
              </p>
              <p className="text-xs text-purple-400 mt-2">
                The agent has automatically improved its research strategy based on performance data.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Partial Content */}
      {(state.partialContent?.length ?? 0) > 0 && (
        <div className="prose prose-invert prose-sm max-w-none">
          <ReactMarkdown>{state.partialContent}</ReactMarkdown>
          {state.status !== 'completed' && (
            <span className="inline-block w-2 h-4 bg-purple-400 animate-pulse ml-1"></span>
          )}
        </div>
      )}

      {/* Error */}
      {state.error && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <p className="text-red-300 text-sm">{state.error}</p>
        </div>
      )}

      {/* Progress indicator */}
      {state.status !== 'completed' && state.status !== 'error' && (state.partialContent?.length ?? 0) === 0 && (state.searchResults?.length ?? 0) === 0 && (
        <div className="space-y-2 animate-pulse">
          <div className="h-4 bg-gray-700/50 rounded w-3/4"></div>
          <div className="h-4 bg-gray-700/50 rounded w-1/2"></div>
        </div>
      )}
    </div>
  );
}

