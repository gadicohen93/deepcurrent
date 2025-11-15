/**
 * Episodes Repository
 *
 * Data access layer for Episode entities.
 * Episodes are telemetry logs of agent runs.
 */

import { prisma } from './db';
import type { Episode, CreateEpisodeInput, SourceRef } from './types';

/**
 * Get an episode by ID
 */
export async function getEpisodeById(episodeId: string): Promise<Episode | null> {
  return prisma.episode.findUnique({
    where: { id: episodeId },
  });
}

/**
 * Get an episode with parsed telemetry data
 */
export async function getEpisodeByIdWithParsedData(episodeId: string) {
  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
    include: {
      topic: true,
      note: true,
    },
  });

  if (!episode) return null;

  return {
    ...episode,
    sourcesReturned: JSON.parse(episode.sourcesReturned) as SourceRef[],
    sourcesSaved: JSON.parse(episode.sourcesSaved) as SourceRef[],
    toolUsage: episode.toolUsage ? JSON.parse(episode.toolUsage) : undefined,
  };
}

/**
 * Create a new episode
 */
export async function createEpisode(input: CreateEpisodeInput): Promise<Episode> {
  return prisma.episode.create({
    data: {
      topicId: input.topicId,
      userId: input.userId,
      strategyVersion: input.strategyVersion,
      query: input.query,
      sourcesReturned: JSON.stringify(input.sourcesReturned),
      sourcesSaved: JSON.stringify(input.sourcesSaved),
      toolUsage: input.toolUsage ? JSON.stringify(input.toolUsage) : undefined,
      followupCount: input.followupCount ?? 0,
      resultNoteId: input.resultNoteId,
      sensoSearchUsed: input.sensoSearchUsed ?? false,
      sensoGenerateUsed: input.sensoGenerateUsed ?? false,
    },
  });
}

/**
 * Get recent episodes for a topic
 */
export async function getRecentEpisodes(
  topicId: string,
  limit = 50
): Promise<Episode[]> {
  return prisma.episode.findMany({
    where: { topicId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/**
 * Get episodes for a specific strategy version
 */
export async function getEpisodesByStrategyVersion(
  topicId: string,
  strategyVersion: number,
  limit?: number
): Promise<Episode[]> {
  return prisma.episode.findMany({
    where: {
      topicId,
      strategyVersion,
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/**
 * Get episodes with metrics for evolution analysis
 */
export async function getEpisodesForEvolution(
  topicId: string,
  limit = 50
) {
  const episodes = await prisma.episode.findMany({
    where: { topicId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return episodes.map((episode) => ({
    ...episode,
    sourcesReturned: JSON.parse(episode.sourcesReturned) as SourceRef[],
    sourcesSaved: JSON.parse(episode.sourcesSaved) as SourceRef[],
    toolUsage: episode.toolUsage ? JSON.parse(episode.toolUsage) : undefined,
    // Calculate save rate
    saveRate: (() => {
      const returned = JSON.parse(episode.sourcesReturned) as SourceRef[];
      const saved = JSON.parse(episode.sourcesSaved) as SourceRef[];
      return returned.length > 0 ? saved.length / returned.length : 0;
    })(),
  }));
}

/**
 * Get episode count by strategy version
 */
export async function getEpisodeCountByVersion(topicId: string) {
  const episodes = await prisma.episode.groupBy({
    by: ['strategyVersion'],
    where: { topicId },
    _count: { id: true },
  });

  return episodes.map((group) => ({
    version: group.strategyVersion,
    count: group._count.id,
  }));
}

/**
 * Calculate metrics for episodes
 */
export async function calculateEpisodeMetrics(
  topicId: string,
  strategyVersion?: number
) {
  const where = strategyVersion !== undefined
    ? { topicId, strategyVersion }
    : { topicId };

  const episodes = await prisma.episode.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });

  if (episodes.length === 0) {
    return {
      totalEpisodes: 0,
      avgFollowupCount: 0,
      avgSaveRate: 0,
      sensoUsageRate: 0,
    };
  }

  const totalFollowups = episodes.reduce((sum, ep) => sum + ep.followupCount, 0);
  const sensoUsageCount = episodes.filter((ep) => ep.sensoSearchUsed || ep.sensoGenerateUsed).length;

  // Calculate average save rate
  const saveRates = episodes.map((ep) => {
    const returned = JSON.parse(ep.sourcesReturned) as SourceRef[];
    const saved = JSON.parse(ep.sourcesSaved) as SourceRef[];
    return returned.length > 0 ? saved.length / returned.length : 0;
  });

  const avgSaveRate = saveRates.reduce((sum, rate) => sum + rate, 0) / saveRates.length;

  return {
    totalEpisodes: episodes.length,
    avgFollowupCount: totalFollowups / episodes.length,
    avgSaveRate,
    sensoUsageRate: sensoUsageCount / episodes.length,
  };
}

/**
 * Delete episodes older than a certain date
 */
export async function deleteOldEpisodes(beforeDate: Date): Promise<number> {
  const result = await prisma.episode.deleteMany({
    where: {
      createdAt: {
        lt: beforeDate,
      },
    },
  });

  return result.count;
}
