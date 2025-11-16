/**
 * Strategy Evolution Alert
 * 
 * Shows notifications when agent strategy has evolved
 */

'use client';

import { useEffect, useState } from 'react';
import { TrendingUp, Zap, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface StrategyEvolution {
  fromVersion: number;
  toVersion: number;
  reason: string;
  timestamp: string;
}

interface StrategyEvolutionAlertProps {
  topicId: string;
}

export function StrategyEvolutionAlert({ topicId }: StrategyEvolutionAlertProps) {
  const [evolutions, setEvolutions] = useState<StrategyEvolution[]>([]);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());

  useEffect(() => {
    // Poll for recent evolutions
    const checkEvolutions = async () => {
      try {
        const response = await fetch(`/api/topics/${topicId}/evolutions?recent=true`);
        if (response.ok) {
          const data = await response.json();
          setEvolutions(data);
        }
      } catch (error) {
        console.error('Error fetching evolutions:', error);
      }
    };

    checkEvolutions();
    const interval = setInterval(checkEvolutions, 30000); // Check every 30s

    return () => clearInterval(interval);
  }, [topicId]);

  const visibleEvolutions = evolutions.filter(
    (evolution) => !dismissed.has(evolution.toVersion)
  );

  if (visibleEvolutions.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      {visibleEvolutions.map((evolution) => (
        <div
          key={evolution.toVersion}
          className="glass-card p-4 rounded-2xl border-purple-500/30 bg-gradient-to-r from-purple-950/40 to-transparent animate-in slide-in-from-top-2 duration-500"
        >
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 mt-0.5">
              <div className="h-8 w-8 rounded-full bg-purple-500/20 flex items-center justify-center">
                <TrendingUp className="h-4 w-4 text-purple-400" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Badge className="bg-purple-900/50 text-purple-200 border-purple-700/50 text-xs">
                  <Zap className="h-3 w-3 mr-1" />
                  Strategy Evolved
                </Badge>
                <span className="text-xs text-gray-500">
                  v{evolution.fromVersion} → v{evolution.toVersion}
                </span>
              </div>
              <p className="text-sm text-gray-300 leading-relaxed">
                {evolution.reason}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {new Date(evolution.timestamp).toLocaleString()}
              </p>
            </div>
            <button
              onClick={() =>
                setDismissed((prev) => new Set([...prev, evolution.toVersion]))
              }
              className="flex-shrink-0 text-gray-500 hover:text-white transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

