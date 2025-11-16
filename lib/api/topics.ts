/**
 * Topics API Client
 *
 * Typed API client for interacting with the topics backend.
 */

import type { Topic as PrismaTopic, StrategyConfig, Note as PrismaNote, StrategyEvolutionLog } from '@/repositories/types';

// Frontend types that match the UI expectations
export interface StrategyConfigPayload {
  version: number;
  status: 'active' | 'candidate' | 'archived';
  rolloutPercentage: number;
  tools: string[];
  sensoFirst: boolean;
  summaryTemplates: ('bullets' | 'comparison' | 'narrative' | 'prd')[];
  timeWindow: 'day' | 'week' | 'month' | 'all';
  searchDepth: 'shallow' | 'deep';
  fitness?: number;
  metrics?: {
    episodes: number;
    saveRate: number;
    sensoReuseRate: number;
    followupPenalty: number;
  };
}

export interface Note {
  id: string;
  topicId: string;
  title: string;
  content: string;
  type: 'research' | 'update';
  createdAt: string;
}

export interface EvolutionLog {
  id: string;
  fromVersion?: number;
  toVersion: number;
  createdAt: string;
  summary: string;
}

export interface Topic {
  id: string;
  title: string;
  description?: string;
  watchEnabled: boolean;
  activeStrategyVersion: number;
  strategies: StrategyConfigPayload[];
  notes: Note[];
  evolutionLogs: EvolutionLog[];
}

export interface TopicWithRelations {
  id: string;
  title: string;
  description: string | null;
  userId: string | null;
  raindropCollectionId: string | null;
  activeStrategyVersion: number | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  strategyConfigs: StrategyConfig[];
  notes: PrismaNote[];
  episodes: any[];
  evolutionLogs: StrategyEvolutionLog[];
}

export interface CreateTopicInput {
  title: string;
  description?: string;
  userId?: string;
  raindropCollectionId?: string;
}

/**
 * Helper to convert Date or string to ISO string
 */
function toISOString(date: Date | string): string {
  if (typeof date === 'string') {
    return date;
  }
  return date.toISOString();
}

/**
 * Transform Prisma topic data to frontend format
 */
function transformTopicToFrontend(topicWithRelations: TopicWithRelations): Topic {
  return {
    id: topicWithRelations.id,
    title: topicWithRelations.title,
    description: topicWithRelations.description || undefined,
    watchEnabled: false, // TODO: Add watchEnabled field to database
    activeStrategyVersion: topicWithRelations.activeStrategyVersion || 0,
    strategies: topicWithRelations.strategyConfigs.map((config) => {
      const parsed = JSON.parse(config.configJson);
      return {
        version: config.version,
        status: config.status as 'active' | 'candidate' | 'archived',
        rolloutPercentage: config.rolloutPercentage,
        ...parsed,
      };
    }),
    notes: topicWithRelations.notes.map((note) => ({
      id: note.id,
      topicId: note.topicId,
      title: note.title,
      content: note.content,
      type: (note.type as 'research' | 'update') || 'research',
      createdAt: toISOString(note.createdAt),
    })),
    evolutionLogs: topicWithRelations.evolutionLogs.map((log) => ({
      id: log.id,
      fromVersion: log.fromVersion || undefined,
      toVersion: log.toVersion,
      createdAt: toISOString(log.createdAt),
      summary: log.reason || 'No summary available',
    })),
  };
}

/**
 * Fetch all topics
 */
export async function fetchTopics(userId?: string): Promise<Topic[]> {
  const url = new URL('/api/topics', window.location.origin);
  if (userId) {
    url.searchParams.set('userId', userId);
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error('Failed to fetch topics');
  }

  const topics = await response.json();

  // For basic list, we need to fetch with relations for each topic
  // This is not optimal - consider adding a list-with-relations endpoint
  const topicsWithRelations = await Promise.all(
    topics.map((topic: PrismaTopic) => fetchTopicWithRelations(topic.id))
  );

  return topicsWithRelations;
}

/**
 * Fetch a specific topic by ID with all relations
 */
export async function fetchTopicWithRelations(topicId: string): Promise<Topic> {
  const response = await fetch(`/api/topics/${topicId}/with-relations`);
  if (!response.ok) {
    throw new Error('Failed to fetch topic');
  }

  const data: TopicWithRelations = await response.json();
  return transformTopicToFrontend(data);
}

/**
 * Create a new topic
 */
export async function createTopic(input: CreateTopicInput): Promise<PrismaTopic> {
  const response = await fetch('/api/topics', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create topic');
  }

  return response.json();
}

/**
 * Update a topic
 */
export async function updateTopic(
  topicId: string,
  data: Partial<Omit<PrismaTopic, 'id' | 'createdAt' | 'updatedAt'>>
): Promise<PrismaTopic> {
  const response = await fetch(`/api/topics/${topicId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update topic');
  }

  return response.json();
}

/**
 * Delete a topic
 */
export async function deleteTopic(topicId: string): Promise<void> {
  const response = await fetch(`/api/topics/${topicId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete topic');
  }
}

/**
 * Search topics
 */
export async function searchTopics(query: string, userId?: string): Promise<Topic[]> {
  const url = new URL('/api/topics/search', window.location.origin);
  url.searchParams.set('q', query);
  if (userId) {
    url.searchParams.set('userId', userId);
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error('Failed to search topics');
  }

  const topics = await response.json();

  // Transform to frontend format with relations
  const topicsWithRelations = await Promise.all(
    topics.map((topic: PrismaTopic) => fetchTopicWithRelations(topic.id))
  );

  return topicsWithRelations;
}
