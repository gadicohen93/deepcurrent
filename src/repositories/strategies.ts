/**
 * Strategy Configurations Repository
 *
 * Data access layer for StrategyConfig entities.
 * Handles versioned agent behavior configurations.
 */

import { prisma } from './db';
import type { StrategyConfig, CreateStrategyConfigInput, StrategyConfigPayload } from './types';

/**
 * Get active strategy for a topic
 */
export async function getActiveStrategy(topicId: string): Promise<StrategyConfig | null> {
  const topic = await prisma.topic.findUnique({
    where: { id: topicId },
  });

  if (!topic?.activeStrategyVersion) {
    return null;
  }

  return prisma.strategyConfig.findFirst({
    where: {
      topicId,
      version: topic.activeStrategyVersion,
    },
  });
}

/**
 * Get active strategy with parsed config
 */
export async function getActiveStrategyWithConfig(
  topicId: string
): Promise<(StrategyConfig & { config: StrategyConfigPayload }) | null> {
  const strategy = await getActiveStrategy(topicId);
  if (!strategy) return null;

  return {
    ...strategy,
    config: JSON.parse(strategy.configJson) as StrategyConfigPayload,
  };
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
 * Get all strategies for a topic
 */
export async function getAllStrategiesForTopic(topicId: string): Promise<StrategyConfig[]> {
  return prisma.strategyConfig.findMany({
    where: { topicId },
    orderBy: { version: 'desc' },
  });
}

/**
 * Create a new strategy version
 */
export async function createStrategyVersion(
  input: CreateStrategyConfigInput
): Promise<StrategyConfig> {
  // Get the max version for this topic
  const maxVersionResult = await prisma.strategyConfig.aggregate({
    where: { topicId: input.topicId },
    _max: { version: true },
  });

  const newVersion = (maxVersionResult._max.version ?? -1) + 1;

  return prisma.strategyConfig.create({
    data: {
      topicId: input.topicId,
      version: newVersion,
      status: input.status ?? 'candidate',
      rolloutPercentage: input.rolloutPercentage ?? 20,
      parentVersion: input.parentVersion,
      configJson: JSON.stringify(input.config),
    },
  });
}

/**
 * Set a strategy version as active
 * This will:
 * 1. Archive all current strategies for the topic
 * 2. Set the specified version to active with 100% rollout
 * 3. Update the topic's activeStrategyVersion
 */
export async function setActiveStrategy(
  topicId: string,
  version: number
): Promise<StrategyConfig> {
  // Use a transaction to ensure consistency
  return prisma.$transaction(async (tx) => {
    // Update topic's active version
    await tx.topic.update({
      where: { id: topicId },
      data: { activeStrategyVersion: version },
    });

    // Archive all other strategies
    await tx.strategyConfig.updateMany({
      where: { topicId },
      data: { status: 'archived' },
    });

    // Set the target strategy to active
    const activeStrategy = await tx.strategyConfig.update({
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

    return activeStrategy;
  });
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
    data: { rolloutPercentage },
  });
}

/**
 * Promote a candidate strategy to active
 */
export async function promoteStrategy(topicId: string, version: number): Promise<StrategyConfig> {
  return setActiveStrategy(topicId, version);
}

/**
 * Archive a strategy version
 */
export async function archiveStrategy(topicId: string, version: number): Promise<StrategyConfig> {
  return prisma.strategyConfig.update({
    where: {
      topicId_version: {
        topicId,
        version,
      },
    },
    data: { status: 'archived' },
  });
}

/**
 * Get candidate strategies for a topic
 */
export async function getCandidateStrategies(topicId: string): Promise<StrategyConfig[]> {
  return prisma.strategyConfig.findMany({
    where: {
      topicId,
      status: 'candidate',
    },
    orderBy: { version: 'desc' },
  });
}
