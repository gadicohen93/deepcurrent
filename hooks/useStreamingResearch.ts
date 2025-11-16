/**
 * Streaming Research Hook
 * 
 * React hook for managing streaming research progress
 */

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
    searchResults: [],
    evaluations: [],
    learnings: [],
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  const startStreaming = useCallback(async (query: string) => {
    // Reset state
    setStreamingState({
      status: 'starting',
      phase: 'Initializing...',
      progress: { current: 0, total: 0 },
      partialContent: '',
      toolCalls: [],
      searchResults: [],
      evaluations: [],
      learnings: [],
    });

    // Create new abort controller for this request
    abortControllerRef.current = new AbortController();

    try {
      // Start streaming request
      const response = await fetch(`/api/topics/${topicId}/ask/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
        signal: abortControllerRef.current.signal,
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
      if (error instanceof Error && error.name === 'AbortError') {
        // User cancelled the request
        setStreamingState((prev) => ({
          ...prev,
          status: 'cancelled',
        }));
      } else {
        console.error('Streaming error:', error);
        setStreamingState((prev) => ({
          ...prev,
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        }));
      }
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

      case 'search_results':
        setStreamingState((prev) => ({
          ...prev,
          searchResults: [...(prev.searchResults || []), event],
        }));
        break;

      case 'evaluation_results':
        setStreamingState((prev) => ({
          ...prev,
          evaluations: [...(prev.evaluations || []), event],
        }));
        break;

      case 'learning_extracted':
        setStreamingState((prev) => ({
          ...prev,
          learnings: [...(prev.learnings || []), event],
        }));
        break;

      case 'progress':
        setStreamingState((prev) => ({
          ...prev,
          progress: { current: event.step, total: event.total },
        }));
        break;

      case 'strategy_evolved':
        setStreamingState((prev) => ({
          ...prev,
          strategyEvolution: {
            fromVersion: event.fromVersion,
            toVersion: event.toVersion,
            reason: event.reason,
          },
        }));
        break;
    }
  };

  const stopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
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

