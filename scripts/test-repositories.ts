/**
 * Repository Test Script
 *
 * Simple script to test the repository layer and verify data integrity.
 *
 * Usage:
 *   npx tsx scripts/test-repositories.ts
 */

import 'dotenv/config';
import {
  topics,
  strategies,
  notes,
  episodes,
  evolutionLogs,
  disconnectPrisma,
} from '../src/repositories';

async function main() {
  console.log('🔍 Testing repository layer...\n');

  // List all topics
  console.log('=== Topics ===');
  const allTopics = await topics.listTopics();
  console.log(`Found ${allTopics.length} topic(s):`);
  allTopics.forEach((topic) => {
    console.log(`  - ${topic.title} (v${topic.activeStrategyVersion ?? 'none'})`);
  });
  console.log();

  if (allTopics.length === 0) {
    console.log('⚠️  No topics found. Run: npx tsx scripts/seed-db.ts\n');
    return;
  }

  const firstTopic = allTopics[0];
  console.log(`Using topic: "${firstTopic.title}" (${firstTopic.id})\n`);

  // Get active strategy
  console.log('=== Active Strategy ===');
  const activeStrategy = await strategies.getActiveStrategyWithConfig(firstTopic.id);
  if (activeStrategy) {
    console.log(`Strategy v${activeStrategy.version} (${activeStrategy.status})`);
    console.log(`  Rollout: ${activeStrategy.rolloutPercentage}%`);
    console.log(`  Config:`, JSON.stringify(activeStrategy.config, null, 2));
  } else {
    console.log('No active strategy');
  }
  console.log();

  // List all strategies
  console.log('=== All Strategies ===');
  const allStrategies = await strategies.getAllStrategiesForTopic(firstTopic.id);
  console.log(`Found ${allStrategies.length} strategy version(s):`);
  allStrategies.forEach((s) => {
    console.log(`  - v${s.version}: ${s.status} (${s.rolloutPercentage}%)`);
  });
  console.log();

  // List notes
  console.log('=== Notes ===');
  const allNotes = await notes.listNotesForTopic(firstTopic.id);
  console.log(`Found ${allNotes.length} note(s):`);
  allNotes.forEach((note) => {
    console.log(`  - "${note.title}" (${note.type ?? 'default'})`);
  });
  console.log();

  // List episodes
  console.log('=== Episodes ===');
  const recentEpisodes = await episodes.getRecentEpisodes(firstTopic.id, 5);
  console.log(`Found ${recentEpisodes.length} recent episode(s):`);
  recentEpisodes.forEach((ep) => {
    console.log(`  - Query: "${ep.query.substring(0, 50)}..."`);
    console.log(`    Strategy: v${ep.strategyVersion}, Followups: ${ep.followupCount}`);
  });
  console.log();

  // Calculate metrics
  console.log('=== Episode Metrics ===');
  const metrics = await episodes.calculateEpisodeMetrics(firstTopic.id);
  console.log(`Total Episodes: ${metrics.totalEpisodes}`);
  console.log(`Avg Followup Count: ${metrics.avgFollowupCount.toFixed(2)}`);
  console.log(`Avg Save Rate: ${(metrics.avgSaveRate * 100).toFixed(1)}%`);
  console.log(`Senso Usage Rate: ${(metrics.sensoUsageRate * 100).toFixed(1)}%`);
  console.log();

  // Evolution logs
  console.log('=== Evolution Logs ===');
  const logs = await evolutionLogs.getEvolutionLogsWithChanges(firstTopic.id);
  console.log(`Found ${logs.length} evolution log(s):`);
  logs.forEach((log) => {
    console.log(`  - v${log.fromVersion ?? 'initial'} → v${log.toVersion}`);
    if (log.reason) {
      console.log(`    Reason: ${log.reason}`);
    }
  });
  console.log();

  console.log('✅ Repository layer test complete!\n');
}

main()
  .catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await disconnectPrisma();
  });
