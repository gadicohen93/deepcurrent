/**
 * Strategy Evolution Service
 * 
 * Analyzes episode performance and evolves agent strategies
 */

import { calculateEpisodeMetrics } from '@/repositories/episodes';
import { createStrategyVersion, getActiveStrategy } from '@/repositories/strategies';
import { prisma } from '@/repositories/db';

interface EpisodeAnalysis {
  episodeId: string;
  topicId: string;
  strategyVersion: number;
  performance: {
    sourcesReturned: number;
    sourcesSaved: number;
    saveRate: number;
    followupCount: number;
    toolUsageCount: number;
    completionTime?: number;
    hadError: boolean;
  };
  recommendation: 'keep' | 'evolve' | 'rollback';
  reason: string;
}

/**
 * Analyze episode performance
 */
export async function analyzeEpisodePerformance(episodeId: string): Promise<EpisodeAnalysis> {
  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
  });

  if (!episode) {
    throw new Error('Episode not found');
  }

  const sourcesReturned = JSON.parse(episode.sourcesReturned);
  const sourcesSaved = JSON.parse(episode.sourcesSaved);
  const toolUsage = episode.toolUsage ? JSON.parse(episode.toolUsage) : [];

  const saveRate = sourcesReturned.length > 0 
    ? sourcesSaved.length / sourcesReturned.length 
    : 0;

  const performance = {
    sourcesReturned: sourcesReturned.length,
    sourcesSaved: sourcesSaved.length,
    saveRate,
    followupCount: episode.followupCount,
    toolUsageCount: toolUsage.length,
    hadError: episode.status === 'failed',
  };

  // Simple heuristic: good performance = high save rate, reasonable follow-ups
  let recommendation: 'keep' | 'evolve' | 'rollback' = 'keep';
  let reason = 'Performance is satisfactory';

  if (performance.hadError) {
    recommendation = 'rollback';
    reason = 'Episode failed with errors';
  } else if (performance.saveRate < 0.3 && sourcesReturned.length > 0) {
    recommendation = 'evolve';
    reason = `Low save rate (${Math.round(saveRate * 100)}%) - strategy needs improvement`;
  } else if (performance.followupCount > 10) {
    recommendation = 'evolve';
    reason = `Too many follow-ups (${performance.followupCount}) - strategy may be inefficient`;
  } else if (performance.saveRate > 0.7) {
    recommendation = 'keep';
    reason = `High save rate (${Math.round(saveRate * 100)}%) - strategy is performing well`;
  }

  return {
    episodeId,
    topicId: episode.topicId,
    strategyVersion: episode.strategyVersion,
    performance,
    recommendation,
    reason,
  };
}

/**
 * Check if strategy should evolve based on recent episodes
 */
export async function shouldEvolveStrategy(
  topicId: string,
  strategyVersion: number,
  minEpisodes: number = 1  // Evolve after every episode for rapid experimentation!
): Promise<{ shouldEvolve: boolean; reason: string; metrics: any }> {
  const metrics = await calculateEpisodeMetrics(topicId, strategyVersion);

  if (metrics.totalEpisodes < minEpisodes) {
    return {
      shouldEvolve: false,
      reason: `Need at least ${minEpisodes} episodes (have ${metrics.totalEpisodes})`,
      metrics,
    };
  }

  // Evolution criteria - VERY aggressive for rapid evolution!
  const lowSaveRate = metrics.avgSaveRate < 0.6; // Even more aggressive
  const highFollowups = metrics.avgFollowupCount > 5; // Lower threshold
  const lowSensoUsage = metrics.sensoUsageRate < 0.2;
  const noSources = metrics.avgSaveRate === 0; // Evolve immediately if no sources
  const anyIssue = metrics.totalEpisodes >= 1; // Always consider evolving after 1 episode

  if (noSources) {
    return {
      shouldEvolve: true,
      reason: `No sources saved - immediate evolution needed`,
      metrics,
    };
  }

  if (lowSaveRate) {
    return {
      shouldEvolve: true,
      reason: `Low save rate (${Math.round(metrics.avgSaveRate * 100)}%) - evolving for improvement`,
      metrics,
    };
  }

  if (highFollowups) {
    return {
      shouldEvolve: true,
      reason: `High follow-ups (${metrics.avgFollowupCount.toFixed(1)}) - optimizing efficiency`,
      metrics,
    };
  }

  // With minEpisodes=1 and aggressive thresholds, almost always evolve
  // Only keep strategy if it's performing exceptionally well
  if (metrics.avgSaveRate >= 0.6 && metrics.avgFollowupCount <= 5) {
    return {
      shouldEvolve: false,
      reason: `Excellent performance (save rate: ${Math.round(metrics.avgSaveRate * 100)}%, followups: ${metrics.avgFollowupCount.toFixed(1)})`,
      metrics,
    };
  }

  return {
    shouldEvolve: true,
    reason: `Continuous improvement mode - evolving to optimize (${metrics.totalEpisodes} episodes)`,
    metrics,
  };
}

/**
 * Evolve strategy based on performance analysis
 */
export async function evolveStrategy(
  topicId: string,
  currentStrategyVersion: number,
  analysis: { metrics: any; reason: string }
): Promise<{ newStrategy: any; evolutionLog: any }> {
  // Get current strategy
  const currentStrategy = await getActiveStrategy(topicId);
  if (!currentStrategy) {
    throw new Error('No active strategy found');
  }

  const currentConfig = JSON.parse(currentStrategy.configJson);

  // Evolve configuration based on metrics
  const newConfig = { ...currentConfig };

  // PRIORITY 1: MODEL SELECTION - Switch models based on performance
  if (analysis.metrics.avgSaveRate < 0.5 && currentConfig.model === 'gpt-4o-mini') {
    newConfig.model = 'gpt-4o';  // Upgrade to smarter model for better quality
    console.log('  → Upgrading to gpt-4o for better quality');
  } else if (analysis.metrics.avgSaveRate > 0.7 && currentConfig.model === 'gpt-4o') {
    newConfig.model = 'gpt-4o-mini';  // Downgrade for speed if quality is good
    console.log('  → Downgrading to gpt-4o-mini for speed (quality is good)');
  }

  // PRIORITY 2: PARALLEL EXECUTION - Trade speed vs thoroughness
  if (analysis.metrics.avgFollowupCount > 6) {
    newConfig.parallelSearches = true;  // Enable parallel for efficiency
    console.log('  → Enabling parallel searches for speed');
  } else if (analysis.metrics.avgSaveRate < 0.4 && !newConfig.parallelSearches) {
    newConfig.parallelSearches = false;  // Sequential for better quality
    console.log('  → Using sequential searches for thoroughness');
  }

  // PRIORITY 3: TOOL SELECTION - Enable/disable tools strategically
  if (analysis.metrics.avgSaveRate === 0) {
    // No sources saved - skip evaluation to save time
    newConfig.skipEvaluation = true;
    newConfig.enabledTools = ['linkup', 'extract'];  // Drop evaluation
    console.log('  → Skipping evaluation step (not helping with quality)');
  } else if (analysis.metrics.avgSaveRate > 0.6 && currentConfig.skipEvaluation) {
    // Quality improved - re-enable evaluation
    newConfig.skipEvaluation = false;
    newConfig.enabledTools = ['linkup', 'evaluate', 'extract'];
    console.log('  → Re-enabling evaluation (quality is improving)');
  }

  // Existing logic: Search depth
  if (analysis.metrics.avgSaveRate < 0.4) {
    newConfig.searchDepth = 'deep';
    newConfig.timeWindow = currentConfig.timeWindow === 'day' ? 'week' : 'month';
    console.log('  → Deepening search and expanding time window');
  }

  // If too many followups, be more selective
  if (analysis.metrics.avgFollowupCount > 5) {
    newConfig.searchDepth = 'shallow';
    newConfig.maxFollowups = 3;
    console.log('  → Limiting to shallow search with max 3 followups');
  }

  // If senso usage is low, enable senso-first
  if (analysis.metrics.sensoUsageRate < 0.2) {
    newConfig.sensoFirst = true;
    console.log('  → Enabling senso-first mode');
  }

  // Create new strategy version
  const newStrategy = await createStrategyVersion({
    topicId,
    status: 'candidate', // Start as candidate for A/B testing
    rolloutPercentage: 20, // Gradual rollout
    parentVersion: currentStrategyVersion,
    config: newConfig as any, // TODO: Type this properly
  });

  // Create evolution log
  const evolutionLog = await prisma.strategyEvolutionLog.create({
    data: {
      topicId,
      fromVersion: currentStrategyVersion,
      toVersion: newStrategy.version,
      reason: `Auto-evolved: ${analysis.reason}`,
      changesJson: JSON.stringify({
        before: currentConfig,
        after: newConfig,
        metrics: analysis.metrics,
      }),
    },
  });

  return { newStrategy, evolutionLog };
}

/**
 * Post-episode hook: Analyze and potentially evolve strategy
 */
export async function postEpisodeAnalysis(episodeId: string): Promise<void> {
  try {
    const analysis = await analyzeEpisodePerformance(episodeId);
    
    console.log(`Episode ${episodeId} analysis:`, analysis);

    // Check if we should evolve the strategy (after EVERY episode for rapid evolution!)
    const evolution = await shouldEvolveStrategy(
      analysis.topicId,
      analysis.strategyVersion,
      1  // Evolve after every single episode!
    );

    if (evolution.shouldEvolve) {
      console.log(`Evolving strategy for topic ${analysis.topicId}:`, evolution.reason);
      
      const { newStrategy, evolutionLog } = await evolveStrategy(
        analysis.topicId,
        analysis.strategyVersion,
        evolution
      );

      console.log(`Created new strategy v${newStrategy.version}`, evolutionLog);
    }
  } catch (error) {
    console.error('Error in post-episode analysis:', error);
    // Don't throw - this is a background operation
  }
}

