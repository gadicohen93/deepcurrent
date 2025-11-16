/**
 * Test Strategy Evolution
 * 
 * Tests the complete self-evolving agent cycle
 */

import { prisma } from '../src/repositories/db';
import { createDefaultStrategy, getActiveStrategy } from '../src/repositories/strategies';
import { createEpisode } from '../src/repositories/episodes';
import { analyzeEpisodePerformance, shouldEvolveStrategy } from '../src/lib/strategyEvolution';

async function main() {
  console.log('\n🧪 Testing Self-Evolving Agent System\n');
  console.log('='.repeat(60));

  // Step 1: Create a test topic with default strategy
  console.log('\n1️⃣  Creating test topic...');
  const topic = await prisma.topic.create({
    data: {
      title: 'Strategy Evolution Test',
      description: 'Testing automatic strategy evolution',
    },
  });
  console.log(`   ✓ Created topic: ${topic.id}`);

  // Step 2: Create default strategy
  console.log('\n2️⃣  Creating default strategy...');
  const strategy = await createDefaultStrategy(topic.id);
  await prisma.topic.update({
    where: { id: topic.id },
    data: { activeStrategyVersion: strategy.version },
  });
  console.log(`   ✓ Created strategy v${strategy.version}`);
  console.log(`   Config: ${strategy.configJson}`);

  // Step 3: Create mock episodes with poor performance
  console.log('\n3️⃣  Creating mock episodes with poor performance...');
  const mockEpisodes = [];
  
  for (let i = 0; i < 6; i++) {
    const episode = await createEpisode({
      topicId: topic.id,
      strategyVersion: strategy.version,
      query: `Test query ${i + 1}`,
      sourcesReturned: [
        { url: 'https://example.com/1', title: 'Source 1' },
        { url: 'https://example.com/2', title: 'Source 2' },
        { url: 'https://example.com/3', title: 'Source 3' },
        { url: 'https://example.com/4', title: 'Source 4' },
      ],
      sourcesSaved: [
        // Only save 1 out of 4 sources = 25% save rate (poor!)
        { url: 'https://example.com/1', title: 'Source 1' },
      ],
      followupCount: i < 3 ? 12 : 10, // High followup count (poor!)
    });

    // Mark as completed
    await prisma.episode.update({
      where: { id: episode.id },
      data: { status: 'completed' },
    });

    mockEpisodes.push(episode);
    console.log(`   ✓ Created episode ${i + 1}/6 (25% save rate, ${i < 3 ? 12 : 10} followups)`);
  }

  // Step 4: Analyze individual episode
  console.log('\n4️⃣  Analyzing episode performance...');
  const firstEpisode = mockEpisodes[0];
  const analysis = await analyzeEpisodePerformance(firstEpisode.id);
  console.log(`   Analysis for episode ${firstEpisode.id}:`);
  console.log(`   - Save Rate: ${Math.round(analysis.performance.saveRate * 100)}%`);
  console.log(`   - Follow-ups: ${analysis.performance.followupCount}`);
  console.log(`   - Recommendation: ${analysis.recommendation}`);
  console.log(`   - Reason: ${analysis.reason}`);

  // Step 5: Check if strategy should evolve
  console.log('\n5️⃣  Checking if strategy should evolve...');
  const evolutionCheck = await shouldEvolveStrategy(topic.id, strategy.version, 5);
  console.log(`   Should evolve: ${evolutionCheck.shouldEvolve}`);
  console.log(`   Reason: ${evolutionCheck.reason}`);
  console.log(`   Metrics:`, evolutionCheck.metrics);

  // Step 6: Trigger evolution (if recommended)
  if (evolutionCheck.shouldEvolve) {
    console.log('\n6️⃣  Triggering strategy evolution...');
    const { evolveStrategy } = await import('../src/lib/strategyEvolution');
    
    const evolution = await evolveStrategy(
      topic.id,
      strategy.version,
      evolutionCheck
    );

    console.log(`   ✓ Created new strategy v${evolution.newStrategy.version}`);
    console.log(`   New config: ${evolution.newStrategy.configJson}`);
    console.log(`   Evolution reason: ${evolution.evolutionLog.reason}`);

    // Step 7: Verify new strategy
    console.log('\n7️⃣  Verifying new strategy...');
    const newActiveStrategy = await getActiveStrategy(topic.id);
    console.log(`   Active strategy version: ${newActiveStrategy?.version ?? 'none'}`);
    console.log(`   Status: ${newActiveStrategy?.status}`);

    // List all strategies
    const allStrategies = await prisma.strategyConfig.findMany({
      where: { topicId: topic.id },
      orderBy: { version: 'asc' },
    });
    console.log(`\n   All strategies for topic:`);
    allStrategies.forEach((s) => {
      console.log(`   - v${s.version}: ${s.status} (${s.rolloutPercentage}%)`);
    });

    // List evolution logs
    const evolutions = await prisma.strategyEvolutionLog.findMany({
      where: { topicId: topic.id },
    });
    console.log(`\n   Evolution logs: ${evolutions.length}`);
    evolutions.forEach((log) => {
      console.log(`   - v${log.fromVersion} → v${log.toVersion}: ${log.reason}`);
    });
  } else {
    console.log('\n6️⃣  Strategy evolution not recommended (need more data or better performance)');
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ Test complete!\n');
  console.log('Next steps:');
  console.log('  1. Check the database for new strategy versions');
  console.log('  2. Run a query to see strategy v2 in action');
  console.log('  3. Watch evolution notifications in the UI\n');
}

main()
  .catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

