'use client';

import { Topic, getActiveStrategy } from '@/lib/mockData';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { formatDistanceToNow } from 'date-fns';

interface AgentBrainPanelProps {
  topic: Topic;
}

export function AgentBrainPanel({ topic }: AgentBrainPanelProps) {
  const activeStrategy = getActiveStrategy(topic);

  if (!activeStrategy) return null;

  const latestEvolution = topic.evolutionLogs.length > 0 
    ? topic.evolutionLogs[topic.evolutionLogs.length - 1]
    : null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="mb-2">
        <h2 className="text-sm uppercase tracking-wide text-gray-500 font-semibold">Agent Brain</h2>
      </div>

      {/* Persona Card */}
      <div className="glass-card p-5 rounded-2xl">
        <div className="mb-4">
          <h3 className="text-base font-semibold text-white">Persona: Developer Researcher</h3>
          <p className="text-xs text-gray-400 mt-1">
            v{activeStrategy.version} (Active) • Optimized for code, repos, and technical papers
          </p>
        </div>

        <div className="space-y-4">
          {/* Tools */}
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">Tools</p>
            <div className="flex flex-wrap gap-2">
              {activeStrategy.tools.map((tool) => (
                <Badge key={tool} className="bg-purple-900/50 text-purple-200 border-purple-700/50 text-xs">
                  {tool}
                </Badge>
              ))}
            </div>
          </div>

          {/* Retrieval */}
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">Retrieval</p>
            <div className="text-sm text-gray-300 flex flex-wrap gap-2">
              <span>{activeStrategy.sensoFirst ? 'Senso-first' : 'Default'}</span>
              <span className="text-gray-600">•</span>
              <span className="capitalize">{activeStrategy.searchDepth} search</span>
              <span className="text-gray-600">•</span>
              <span className="capitalize">{activeStrategy.timeWindow} window</span>
            </div>
          </div>

          {/* Output */}
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">Output Style</p>
            <div className="flex flex-wrap gap-2">
              {activeStrategy.summaryTemplates.map((template) => (
                <Badge key={template} className="bg-indigo-900/50 text-indigo-200 border-indigo-700/50 text-xs capitalize">
                  {template}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Performance Metrics */}
      {activeStrategy.metrics && (
        <div className="glass-card p-5 rounded-2xl">
          <div className="mb-4">
            <h3 className="text-base font-semibold text-white">Performance</h3>
            <p className="text-xs text-gray-400">
              This strategy has been used for {activeStrategy.metrics.episodes} runs
            </p>
          </div>

          {/* Big numbers */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="text-center p-3 bg-black/20 rounded-lg">
              <p className="text-3xl font-bold text-white">{activeStrategy.metrics.episodes}</p>
              <p className="text-xs text-gray-400 mt-1">Episodes</p>
            </div>
            {activeStrategy.fitness && (
              <div className="text-center p-3 bg-black/20 rounded-lg">
                <p className="text-3xl font-bold text-white">{activeStrategy.fitness.toFixed(2)}</p>
                <p className="text-xs text-gray-400 mt-1">Fitness</p>
              </div>
            )}
          </div>

          {/* Sub-metrics grid */}
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div className="text-center">
              <p className="text-gray-400 mb-1">Save Rate</p>
              <p className="font-semibold text-white">
                {Math.round(activeStrategy.metrics.saveRate * 100)}%
              </p>
            </div>
            <div className="text-center">
              <p className="text-gray-400 mb-1">Senso Reuse</p>
              <p className="font-semibold text-white">
                {Math.round(activeStrategy.metrics.sensoReuseRate * 100)}%
              </p>
            </div>
            <div className="text-center">
              <p className="text-gray-400 mb-1">Follow-up</p>
              <p className="font-semibold text-white">
                {Math.round(activeStrategy.metrics.followupPenalty * 100)}%
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Strategy Versions */}
      <div className="glass-card p-5 rounded-2xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold text-white">Strategy versions ({topic.strategies.length})</h3>
          </div>
          <Link href={`/topics/${topic.id}/replay`}>
            <Button size="sm" className="bg-purple-900/50 text-purple-200 border border-purple-700/50 hover:bg-purple-800/50 text-xs h-7">
              Replay
            </Button>
          </Link>
        </div>
        <div className="space-y-2">
          {topic.strategies
            .sort((a, b) => b.version - a.version)
            .map((strategy) => {
              const isActive = strategy.version === topic.activeStrategyVersion;
              const previousStrategy = topic.strategies.find(
                (s) => s.version === strategy.version - 1
              );
              const fitnessChange =
                strategy.fitness && previousStrategy?.fitness
                  ? strategy.fitness - previousStrategy.fitness
                  : null;

              return (
                <div
                  key={strategy.version}
                  className="flex items-center justify-between p-2.5 border border-white/10 rounded-lg bg-black/20 hover:bg-black/30 transition-colors cursor-pointer"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-white text-sm">v{strategy.version}</span>
                      <Badge
                        className={
                          isActive 
                            ? 'bg-gradient-button text-white border-0 text-xs' 
                            : strategy.status === 'candidate' 
                            ? 'bg-purple-900/50 text-purple-200 border-purple-700/50 text-xs' 
                            : 'bg-gray-800/50 text-gray-400 border-gray-700/50 text-xs'
                        }
                      >
                        {isActive ? 'Active' : strategy.status === 'candidate' ? `Candidate ${strategy.rolloutPercentage}%` : 'Archived'}
                      </Badge>
                    </div>
                    {strategy.fitness && (
                      <div className="text-xs text-gray-500">
                        Fitness: {strategy.fitness.toFixed(2)}
                      </div>
                    )}
                  </div>
                  {fitnessChange !== null && (
                    <div className="flex items-center gap-1 text-xs">
                      {fitnessChange > 0 ? (
                        <>
                          <TrendingUp className="h-3 w-3 text-green-400" />
                          <span className="text-green-400 font-medium">+{fitnessChange.toFixed(2)}</span>
                        </>
                      ) : fitnessChange < 0 ? (
                        <>
                          <TrendingDown className="h-3 w-3 text-red-400" />
                          <span className="text-red-400 font-medium">{fitnessChange.toFixed(2)}</span>
                        </>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </div>

      {/* Last Evolution - compact */}
      {latestEvolution && (
        <div className="glass-card p-4 rounded-2xl bg-purple-950/20 border-purple-800/30">
          <div className="flex items-start gap-3">
            <div className="text-purple-400 mt-0.5">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-purple-300 font-medium mb-1">
                Last change: v{latestEvolution.fromVersion !== undefined ? latestEvolution.fromVersion : '?'} → v{latestEvolution.toVersion}
              </p>
              <p className="text-xs text-gray-400 leading-relaxed">
                {latestEvolution.summary}
              </p>
              <p className="text-xs text-gray-600 mt-1">
                {formatDistanceToNow(new Date(latestEvolution.createdAt), { addSuffix: true })}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

