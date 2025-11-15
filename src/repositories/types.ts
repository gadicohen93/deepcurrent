/**
 * Core Platform Types
 *
 * TypeScript types for the DeepCurrent data model.
 * These complement the Prisma-generated types.
 */

import type { Topic, StrategyConfig, Note, Episode, StrategyEvolutionLog } from '@prisma/client';

// Re-export Prisma types
export type { Topic, StrategyConfig, Note, Episode, StrategyEvolutionLog };

/**
 * SourceRef - Reference to a research source
 */
export interface SourceRef {
  url: string;
  title?: string;
  source?: string; // 'senso' | 'airia' | 'raindrop' | 'web'
  timestamp?: string;
  snippet?: string;
}

/**
 * Strategy Configuration payload
 * This is what gets stored in StrategyConfig.configJson
 */
export interface StrategyConfigPayload {
  // Tool configuration
  tools: {
    senso: boolean;
    airia: boolean;
    raindrop: boolean;
    webSearch: boolean;
  };

  // Search behavior
  searchStrategy: 'senso-first' | 'web-first' | 'balanced';

  // Domain weights (for ranking/scoring)
  domainWeights?: Record<string, number>;

  // Summary preferences
  summaryFormat?: 'brief' | 'detailed' | 'technical';

  // Call patterns
  callPatterns?: {
    maxQueries?: number;
    followUpDepth?: number;
    parallelQueries?: boolean;
  };

  // Any other config
  [key: string]: unknown;
}

/**
 * Input types for creating entities
 */
export interface CreateTopicInput {
  title: string;
  description?: string;
  userId?: string;
  raindropCollectionId?: string;
}

export interface CreateStrategyConfigInput {
  topicId: string;
  config: StrategyConfigPayload;
  parentVersion?: number;
  status?: 'active' | 'candidate' | 'archived';
  rolloutPercentage?: number;
}

export interface CreateNoteInput {
  topicId: string;
  title: string;
  content: string;
  type?: string;
}

export interface CreateEpisodeInput {
  topicId: string;
  userId?: string;
  strategyVersion: number;
  query: string;
  sourcesReturned: SourceRef[];
  sourcesSaved: SourceRef[];
  toolUsage?: Record<string, unknown>;
  followupCount?: number;
  resultNoteId?: string;
  sensoSearchUsed?: boolean;
  sensoGenerateUsed?: boolean;
}

export interface CreateEvolutionLogInput {
  topicId: string;
  fromVersion?: number;
  toVersion: number;
  reason?: string;
  changes?: Record<string, unknown>;
}
