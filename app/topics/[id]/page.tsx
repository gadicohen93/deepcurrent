'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { fetchTopicWithRelations, type Topic, type Note } from '@/lib/api/topics';
import { NoteCard } from '@/components/topic/NoteCard';
import { StreamingNoteCard } from '@/components/topic/StreamingNoteCard';
import { QueryInput } from '@/components/topic/QueryInput';
import { LiveAgentBrainPanel } from '@/components/agent/LiveAgentBrainPanel';
import { useStreamingResearch } from '@/hooks/useStreamingResearch';
import { useRecentEvolutions } from '@/hooks/useRecentEvolutions';
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
  const { evolutions, dismissEvolution } = useRecentEvolutions(topicId, true);
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
      // Refetch topic to get the new note and updated strategies
      fetchTopicWithRelations(topicId).then((data) => {
        setTopic(data); // Update entire topic (includes strategies)
        setNotes(data.notes);
      });
    }
  }, [streamingState.status, streamingState.noteId, topicId]);

  // Refetch topic when evolution is detected
  useEffect(() => {
    if (evolutions.length > 0) {
      fetchTopicWithRelations(topicId).then((data) => {
        setTopic(data); // Update to show new strategy versions
      });
    }
  }, [evolutions.length, topicId]);

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

  const handleQuery = async (query: string) => {
    setCurrentQuery(query);
    await startStreaming(query);
  };

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
              {/* Stats bar */}
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
            {/* Evolution Notifications */}
            {evolutions.length > 0 && (
              <div className="space-y-2">
                {evolutions.map((evolution) => {
                  const changes = evolution.changes;
                  const before = changes?.before ?? {};
                  const after = changes?.after ?? {};
                  const metrics = changes?.metrics;

                  // Identify what changed
                  const changedParams: Array<{key: string, before: unknown, after: unknown}> = [];
                  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
                  allKeys.forEach(key => {
                    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
                      changedParams.push({ key, before: before[key], after: after[key] });
                    }
                  });

                  return (
                    <div
                      key={evolution.toVersion}
                      className="glass-card p-4 rounded-2xl border-purple-500/30 bg-gradient-to-r from-purple-500/20 to-pink-500/20 animate-in slide-in-from-top-2"
                    >
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
                              v{evolution.fromVersion} → v{evolution.toVersion}
                            </span>
                          </div>
                          <p className="text-sm text-gray-300 leading-relaxed mb-3">
                            {evolution.reason}
                          </p>

                          {/* Performance Metrics that triggered evolution */}
                          {metrics && (
                            <div className="mb-3 p-2 bg-black/20 rounded-lg">
                              <p className="text-xs text-gray-400 mb-1.5">📊 Performance Metrics:</p>
                              <div className="grid grid-cols-3 gap-2 text-xs">
                                {metrics.avgSaveRate !== undefined && (
                                  <div>
                                    <span className="text-gray-400">Save Rate:</span>{' '}
                                    <span className="font-medium text-white">
                                      {Math.round(metrics.avgSaveRate * 100)}%
                                    </span>
                                  </div>
                                )}
                                {metrics.avgFollowupCount !== undefined && (
                                  <div>
                                    <span className="text-gray-400">Follow-ups:</span>{' '}
                                    <span className="font-medium text-white">
                                      {metrics.avgFollowupCount.toFixed(1)}
                                    </span>
                                  </div>
                                )}
                                {metrics.totalEpisodes !== undefined && (
                                  <div>
                                    <span className="text-gray-400">Episodes:</span>{' '}
                                    <span className="font-medium text-white">
                                      {metrics.totalEpisodes}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Parameter Changes */}
                          {changedParams.length > 0 && (
                            <div className="space-y-1.5">
                              <p className="text-xs text-gray-400 mb-1">🔧 Changes:</p>
                              {changedParams.map(({ key, before: beforeVal, after: afterVal }) => {
                                const formatValue = (val: unknown): string => {
                                  if (typeof val === 'boolean') {
                                    return val ? '✓' : '✗';
                                  }
                                  if (Array.isArray(val)) {
                                    return val.join(', ');
                                  }
                                  if (typeof val === 'object' && val !== null) {
                                    return JSON.stringify(val);
                                  }
                                  return String(val);
                                };

                                return (
                                  <div key={key} className="text-xs flex items-center gap-2 bg-black/10 rounded px-2 py-1">
                                    <span className="font-medium text-purple-300 capitalize">
                                      {key.replace(/([A-Z])/g, ' $1').trim()}:
                                    </span>
                                    <span className="text-gray-400 line-through">
                                      {formatValue(beforeVal)}
                                    </span>
                                    <span className="text-gray-500">→</span>
                                    <span className="text-green-400 font-medium">
                                      {formatValue(afterVal)}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          <p className="text-xs text-purple-400 mt-3">
                            💡 The agent self-optimized based on real performance data
                          </p>
                        </div>
                        <button
                          onClick={() => dismissEvolution(evolution.toVersion)}
                          className="text-gray-500 hover:text-white transition-colors"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
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
              <LiveAgentBrainPanel 
                topic={topic} 
                streamingState={streamingState}
                isStreaming={isStreaming}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

