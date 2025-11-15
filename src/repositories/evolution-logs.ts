/**
 * Strategy Evolution Logs Repository
 *
 * Data access layer for StrategyEvolutionLog entities.
 * Tracks the changelog of agent learning and strategy evolution.
 */

import { prisma } from './db';
import type { StrategyEvolutionLog, CreateEvolutionLogInput } from './types';

/**
 * Get an evolution log by ID
 */
export async function getEvolutionLogById(logId: string): Promise<StrategyEvolutionLog | null> {
  return prisma.strategyEvolutionLog.findUnique({
    where: { id: logId },
  });
}

/**
 * Get an evolution log with parsed changes
 */
export async function getEvolutionLogByIdWithParsedChanges(logId: string) {
  const log = await prisma.strategyEvolutionLog.findUnique({
    where: { id: logId },
    include: {
      topic: true,
    },
  });

  if (!log) return null;

  return {
    ...log,
    changes: log.changesJson ? JSON.parse(log.changesJson) : undefined,
  };
}

/**
 * Create a new evolution log
 */
export async function createEvolutionLog(
  input: CreateEvolutionLogInput
): Promise<StrategyEvolutionLog> {
  return prisma.strategyEvolutionLog.create({
    data: {
      topicId: input.topicId,
      fromVersion: input.fromVersion,
      toVersion: input.toVersion,
      reason: input.reason,
      changesJson: input.changes ? JSON.stringify(input.changes) : undefined,
    },
  });
}

/**
 * Get evolution logs for a topic
 */
export async function getEvolutionLogsForTopic(
  topicId: string,
  limit?: number
): Promise<StrategyEvolutionLog[]> {
  return prisma.strategyEvolutionLog.findMany({
    where: { topicId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/**
 * Get evolution logs with parsed changes
 */
export async function getEvolutionLogsWithChanges(
  topicId: string,
  limit?: number
) {
  const logs = await prisma.strategyEvolutionLog.findMany({
    where: { topicId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return logs.map((log) => ({
    ...log,
    changes: log.changesJson ? JSON.parse(log.changesJson) : undefined,
  }));
}

/**
 * Get evolution log for a specific version transition
 */
export async function getEvolutionLogForTransition(
  topicId: string,
  fromVersion: number,
  toVersion: number
): Promise<StrategyEvolutionLog | null> {
  return prisma.strategyEvolutionLog.findFirst({
    where: {
      topicId,
      fromVersion,
      toVersion,
    },
  });
}

/**
 * Get latest evolution log for a topic
 */
export async function getLatestEvolutionLog(
  topicId: string
): Promise<StrategyEvolutionLog | null> {
  return prisma.strategyEvolutionLog.findFirst({
    where: { topicId },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Get evolution timeline (all logs in chronological order)
 */
export async function getEvolutionTimeline(topicId: string) {
  const logs = await prisma.strategyEvolutionLog.findMany({
    where: { topicId },
    orderBy: { createdAt: 'asc' },
  });

  return logs.map((log) => ({
    ...log,
    changes: log.changesJson ? JSON.parse(log.changesJson) : undefined,
  }));
}

/**
 * Delete evolution logs for a topic
 */
export async function deleteEvolutionLogsForTopic(topicId: string): Promise<number> {
  const result = await prisma.strategyEvolutionLog.deleteMany({
    where: { topicId },
  });

  return result.count;
}
