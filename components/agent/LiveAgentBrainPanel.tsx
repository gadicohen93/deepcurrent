/**
 * Live Agent Brain Panel - Enhanced with real-time execution data
 * 
 * Shows both static strategy configuration and live agent execution details
 */

'use client';

import { Topic, getActiveStrategy } from '@/lib/mockData';
import { Badge } from '@/components/ui/badge';
import { Brain, Zap, Activity, CheckCircle, Search, Lightbulb } from 'lucide-react';
import type { StreamingResearchState } from '@/lib/api/research';

interface LiveAgentBrainPanelProps {
  topic: Topic;
  streamingState?: StreamingResearchState;
  isStreaming?: boolean;
}

export function LiveAgentBrainPanel({ topic, streamingState, isStreaming }: LiveAgentBrainPanelProps) {
  const activeStrategy = getActiveStrategy(topic);
  
  // Get the newest strategy (highest version) - this is what just evolved!
  const newestStrategy = topic.strategies.length > 0
    ? topic.strategies.reduce((latest, current) => 
        current.version > latest.version ? current : latest
      )
    : null;
  
  // Show newest strategy if it exists and is different from active
  const displayStrategy = newestStrategy || activeStrategy;

  if (!displayStrategy) {
    return (
      <div className="glass-card p-5 rounded-2xl">
        <div className="flex items-center gap-2 mb-3">
          <Brain className="h-5 w-5 text-gray-400" />
          <h2 className="text-sm uppercase tracking-wide text-gray-500 font-semibold">Agent Brain</h2>
        </div>
        <p className="text-sm text-gray-400">No active strategy configured</p>
      </div>
    );
  }
  
  const isNewestDifferent = newestStrategy && activeStrategy && newestStrategy.version !== activeStrategy.version;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <Brain className="h-5 w-5 text-purple-400" />
        <h2 className="text-sm uppercase tracking-wide text-gray-500 font-semibold">Agent Brain</h2>
        {isStreaming && (
          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 text-xs">
            <Activity className="h-3 w-3 animate-pulse" />
            Live
          </span>
        )}
      </div>

      {/* Live Execution Status */}
      {isStreaming && streamingState && (
        <div className="glass-card p-4 rounded-2xl border-purple-500/30 bg-gradient-to-br from-purple-950/30 to-transparent">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="h-4 w-4 text-purple-400" />
            <h3 className="text-sm font-semibold text-white">Current Execution</h3>
          </div>

          {/* Status */}
          <div className="mb-3">
            <div className="text-xs text-gray-400 mb-1">Status</div>
            <div className="text-sm text-purple-300">{streamingState.phase || streamingState.status}</div>
          </div>

          {/* Tool Activity */}
          {streamingState.toolCalls && streamingState.toolCalls.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs text-gray-400">Recent Tool Calls</div>
              {streamingState.toolCalls.slice(-5).map((call, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <CheckCircle className="h-3 w-3 text-green-400 flex-shrink-0" />
                  <span className="text-gray-300 truncate">{call.tool}</span>
                </div>
              ))}
            </div>
          )}

          {/* Live Metrics */}
          <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-purple-500/20">
            <div className="text-center">
              <div className="text-lg font-bold text-white">{streamingState.searchResults?.length ?? 0}</div>
              <div className="text-[10px] text-gray-400">Searches</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-white">
                {streamingState.evaluations?.reduce((acc, e) => acc + e.relevant, 0) ?? 0}
              </div>
              <div className="text-[10px] text-gray-400">Relevant</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-white">{streamingState.learnings?.length ?? 0}</div>
              <div className="text-[10px] text-gray-400">Insights</div>
            </div>
          </div>
        </div>
      )}

      {/* Strategy Configuration */}
      <div className="glass-card p-5 rounded-2xl">
        <div className="mb-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-white">Strategy Config</h3>
              <div className="flex items-center gap-2 mt-1">
                {isNewestDifferent && (
                  <Badge className="bg-gradient-to-r from-purple-500/30 to-pink-500/30 text-purple-300 border-purple-500/50 text-xs font-semibold">
                    🆕 Latest: v{newestStrategy.version}
                  </Badge>
                )}
                <p className="text-xs text-gray-400">
                  {isNewestDifferent ? (
                    <>
                      Active: v{activeStrategy.version} • {activeStrategy.status}
                    </>
                  ) : (
                    <>
                      v{displayStrategy.version} • {displayStrategy.status}
                    </>
                  )}
                  {topic.strategies.length > 1 && (
                    <span className="text-purple-400 ml-2">
                      ({topic.strategies.length} versions)
                    </span>
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {/* Tools */}
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">Active Tools</p>
            <div className="flex flex-wrap gap-2">
              {displayStrategy.tools.map((tool) => (
                <Badge key={tool} className="bg-purple-900/50 text-purple-200 border-purple-700/50 text-xs">
                  {tool}
                </Badge>
              ))}
            </div>
          </div>

          {/* Configuration */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-gray-400 mb-1">Search Depth</p>
              <p className="font-medium text-white capitalize">{displayStrategy.searchDepth}</p>
            </div>
            <div>
              <p className="text-gray-400 mb-1">Time Window</p>
              <p className="font-medium text-white capitalize">{displayStrategy.timeWindow}</p>
            </div>
          </div>
          
          {/* Show new parameters if they exist */}
          {(displayStrategy as any).model && (
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <p className="text-gray-400 mb-1">Model</p>
                <p className="font-medium text-white">{((displayStrategy as any).model || 'gpt-4o-mini').replace('gpt-', '')}</p>
              </div>
              {(displayStrategy as any).parallelSearches !== undefined && (
                <div>
                  <p className="text-gray-400 mb-1">Execution</p>
                  <p className="font-medium text-white capitalize">
                    {(displayStrategy as any).parallelSearches ? 'Parallel' : 'Sequential'}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Show all strategy versions if more than one */}
        {topic.strategies.length > 1 && (
          <div className="mt-3 pt-3 border-t border-white/10">
            <p className="text-xs text-gray-500 mb-2">All Versions</p>
            <div className="flex flex-wrap gap-1.5">
              {topic.strategies
                .sort((a, b) => b.version - a.version) // Show newest first
                .map((strategy) => {
                  const isActive = strategy.version === topic.activeStrategyVersion;
                  const isNewest = strategy.version === Math.max(...topic.strategies.map(s => s.version));
                  return (
                    <span
                      key={strategy.version}
                      className={`text-xs px-2 py-1 rounded ${
                        isNewest && !isActive
                          ? 'bg-gradient-to-r from-purple-500/30 to-pink-500/30 text-purple-300 font-semibold ring-1 ring-purple-500/50'
                          : isActive && isNewest
                          ? 'bg-gradient-to-r from-purple-500/30 to-pink-500/30 text-purple-300 font-semibold ring-1 ring-purple-500/50'
                          : isActive
                          ? 'bg-purple-900/50 text-purple-300 font-medium'
                          : strategy.status === 'candidate'
                          ? 'bg-yellow-900/30 text-yellow-400 font-medium'
                          : 'bg-gray-800/50 text-gray-500'
                      }`}
                    >
                      v{strategy.version}
                      {isNewest && !isActive && ' 🆕'}
                      {isNewest && isActive && ' 🆕'}
                      {strategy.status === 'candidate' && ` ${strategy.rolloutPercentage}%`}
                    </span>
                  );
                })}
            </div>
            {isNewestDifferent && (
              <p className="text-xs text-purple-400 mt-2">
                💡 Latest evolution (v{newestStrategy.version}) shown above • Active: v{activeStrategy.version}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Performance Metrics */}
      {displayStrategy.metrics && !isStreaming && (
        <div className="glass-card p-5 rounded-2xl">
          <div className="mb-4">
            <h3 className="text-base font-semibold text-white">Performance</h3>
            <p className="text-xs text-gray-400">
              Based on {displayStrategy.metrics.episodes} runs
              {isNewestDifferent && (
                <span className="text-purple-400 ml-1">(v{displayStrategy.version})</span>
              )}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="text-center p-3 bg-black/20 rounded-lg">
              <p className="text-2xl font-bold text-white">{displayStrategy.metrics.episodes}</p>
              <p className="text-xs text-gray-400 mt-1">Episodes</p>
            </div>
            {displayStrategy.fitness && (
              <div className="text-center p-3 bg-black/20 rounded-lg">
                <p className="text-2xl font-bold text-white">{displayStrategy.fitness.toFixed(2)}</p>
                <p className="text-xs text-gray-400 mt-1">Fitness</p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3 text-xs mt-3">
            <div className="text-center">
              <p className="text-gray-400 mb-1">Save Rate</p>
              <p className="font-semibold text-white">
                {Math.round(displayStrategy.metrics.saveRate * 100)}%
              </p>
            </div>
            <div className="text-center">
              <p className="text-gray-400 mb-1">Senso Reuse</p>
              <p className="font-semibold text-white">
                {Math.round(displayStrategy.metrics.sensoReuseRate * 100)}%
              </p>
            </div>
            <div className="text-center">
              <p className="text-gray-400 mb-1">Follow-up</p>
              <p className="font-semibold text-white">
                {Math.round(displayStrategy.metrics.followupPenalty * 100)}%
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Quick Insights from Recent Learnings */}
      {streamingState?.learnings && streamingState.learnings.length > 0 && (
        <div className="glass-card p-4 rounded-2xl bg-purple-950/20 border-purple-800/30">
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="h-4 w-4 text-purple-400" />
            <h3 className="text-sm font-semibold text-purple-300">Latest Insights</h3>
          </div>
          <div className="space-y-2">
            {streamingState.learnings.slice(-2).map((learning, i) => (
              <div key={i} className="text-xs text-gray-300 leading-relaxed">
                • {learning.learning.substring(0, 100)}...
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

