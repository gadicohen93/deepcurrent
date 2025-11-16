/**
 * Strategy Config Repository
 *
 * Data access layer for StrategyConfig entities
 */

import { prisma } from './db';
import type { StrategyConfig, CreateStrategyConfigInput } from './types';

/**
 * Get all strategies for a topic
 */
export async function getStrategiesForTopic(topicId: string): Promise<StrategyConfig[]> {
  return prisma.strategyConfig.findMany({
    where: { topicId },
    orderBy: { version: 'desc' },
  });
}

/**
 * Get a specific strategy version
 */
export async function getStrategyByVersion(
  topicId: string,
  version: number
): Promise<StrategyConfig | null> {
  return prisma.strategyConfig.findUnique({
    where: {
      topicId_version: {
        topicId,
        version,
      },
    },
  });
}

/**
 * Get the active strategy for a topic
 */
export async function getActiveStrategy(topicId: string): Promise<StrategyConfig | null> {
  const strategies = await prisma.strategyConfig.findMany({
    where: {
      topicId,
      status: 'active',
    },
    orderBy: { version: 'desc' },
    take: 1,
  });

  return strategies[0] || null;
}

/**
 * Create a new strategy version
 * @param input - Strategy configuration input
 */
export async function createStrategyVersion(
  input: CreateStrategyConfigInput
): Promise<StrategyConfig> {
  // Get the next version number
  const existingStrategies = await getStrategiesForTopic(input.topicId);
  const nextVersion = existingStrategies.length > 0
    ? Math.max(...existingStrategies.map((s) => s.version)) + 1
    : 1;

  return prisma.strategyConfig.create({
    data: {
      topicId: input.topicId,
      version: nextVersion,
      status: input.status ?? 'active',
      rolloutPercentage: input.rolloutPercentage ?? 100,
      parentVersion: input.parentVersion,
      configJson: JSON.stringify(input.config),
    },
  });
}

/**
 * Create default strategy for a new topic
 * @param topicId - The topic ID to create strategy for
 */
export async function createDefaultStrategy(topicId: string): Promise<StrategyConfig> {
  const defaultConfig = {
    // Core tools
    tools: ['linkupSearchTool', 'evaluateResultsBatchTool', 'extractLearningsTool'],
    
    // Search behavior
    searchDepth: 'standard',
    timeWindow: 'week',
    maxFollowups: undefined,
    
    // Tool preferences
    sensoFirst: false,
    skipEvaluation: false,  // New: Skip evaluation for speed
    
    // Output formatting
    summaryTemplates: ['bullets', 'narrative'],
    
    // Execution control (NEW - Top priority parameters!)
    model: 'gpt-4o-mini',           // 1. Model selection
    parallelSearches: false,         // 2. Parallel vs sequential
    enabledTools: ['linkup', 'evaluate', 'extract'],  // 3. Tool selection
  };

  return createStrategyVersion({
    topicId,
    status: 'active',
    rolloutPercentage: 100,
    config: defaultConfig as any,
  });
}

/**
 * Set a strategy as active (and deactivate others)
 */
export async function setActiveStrategy(
  topicId: string,
  version: number
): Promise<StrategyConfig> {
  // Deactivate all current active strategies
  await prisma.strategyConfig.updateMany({
    where: {
      topicId,
      status: 'active',
    },
    data: {
      status: 'archived',
    },
  });

  // Activate the specified version
  const strategy = await prisma.strategyConfig.update({
    where: {
      topicId_version: {
        topicId,
        version,
      },
    },
    data: {
      status: 'active',
      rolloutPercentage: 100,
    },
  });

  // Update the topic's activeStrategyVersion
  await prisma.topic.update({
    where: { id: topicId },
    data: { activeStrategyVersion: version },
  });

  return strategy;
}

/**
 * Update strategy rollout percentage (for A/B testing)
 */
export async function updateStrategyRollout(
  topicId: string,
  version: number,
  rolloutPercentage: number
): Promise<StrategyConfig> {
  return prisma.strategyConfig.update({
    where: {
      topicId_version: {
        topicId,
        version,
      },
    },
    data: {
      rolloutPercentage,
    },
  });
}

/**
 * Archive a strategy version
 */
export async function archiveStrategy(
  topicId: string,
  version: number
): Promise<StrategyConfig> {
  return prisma.strategyConfig.update({
    where: {
      topicId_version: {
        topicId,
        version,
      },
    },
    data: {
      status: 'archived',
    },
  });
}
