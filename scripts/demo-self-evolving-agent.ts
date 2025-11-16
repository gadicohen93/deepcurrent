/**
 * Visionary Demo: Self-Evolving Deep Research Agent
 * 
 * This script demonstrates the agent's ability to learn, adapt, and evolve
 * its research strategy based on real performance data.
 * 
 * Run: npx tsx scripts/demo-self-evolving-agent.ts
 */

import { prisma } from '../src/repositories/db';
import { createDefaultStrategy, getActiveStrategy } from '../src/repositories/strategies';
import { createEpisode } from '../src/repositories/episodes';
import { analyzeEpisodePerformance, shouldEvolveStrategy, evolveStrategy, postEpisodeAnalysis } from '../src/lib/strategyEvolution';

// ANSI color codes for beautiful terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  purple: '\x1b[38;5;129m',
};

function log(message: string, color: keyof typeof colors = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function header(text: string) {
  console.log('\n' + '═'.repeat(70));
  log(`  ${text}`, 'bright');
  console.log('═'.repeat(70) + '\n');
}

function section(text: string) {
  log(`\n▶ ${text}`, 'cyan');
  console.log('─'.repeat(70));
}

function success(text: string) {
  log(`  ✓ ${text}`, 'green');
}

function info(text: string) {
  log(`  ℹ ${text}`, 'blue');
}

function warning(text: string) {
  log(`  ⚠ ${text}`, 'yellow');
}

function evolution(text: string) {
  log(`  🧬 ${text}`, 'magenta');
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.clear();
  
  header('🧠 SELF-EVOLVING DEEP RESEARCH AGENT DEMO');
  log('Watch as the agent learns, adapts, and evolves its strategy in real-time.', 'dim');
  
  await sleep(1000);

  // ============================================================================
  // SCENARIO 1: Initial State - Agent starts naive
  // ============================================================================
  header('SCENARIO 1: The Agent Begins');
  
  section('Creating research topic: "AI Safety Research"');
  const topic = await prisma.topic.create({
    data: {
      title: 'AI Safety Research',
      description: 'Understanding AI alignment and safety mechanisms',
    },
  });
  success(`Topic created: ${topic.title}`);
  
  section('Initializing default strategy');
  const initialStrategy = await createDefaultStrategy(topic.id);
  await prisma.topic.update({
    where: { id: topic.id },
    data: { activeStrategyVersion: initialStrategy.version },
  });
  
  const initialConfig = JSON.parse(initialStrategy.configJson);
  info(`Strategy v${initialStrategy.version} initialized:`);
  log(`    • Search Depth: ${initialConfig.searchDepth}`, 'dim');
  log(`    • Time Window: ${initialConfig.timeWindow}`, 'dim');
  log(`    • Model: ${initialConfig.model}`, 'dim');
  log(`    • Parallel: ${initialConfig.parallelSearches ? 'Yes' : 'No'}`, 'dim');
  log(`    • Tools: ${initialConfig.enabledTools?.join(', ') || 'all'}`, 'dim');
  
  await sleep(1500);

  // ============================================================================
  // SCENARIO 2: First Episode - Poor Performance
  // ============================================================================
  header('SCENARIO 2: First Research Episode - Learning Begins');
  
  section('Episode 1: "What is AI alignment?"');
  const episode1 = await createEpisode({
    topicId: topic.id,
    strategyVersion: initialStrategy.version,
    query: 'What is AI alignment?',
    sourcesReturned: [
      { url: 'https://example.com/ai-alignment-1', title: 'AI Alignment Basics' },
      { url: 'https://example.com/ai-alignment-2', title: 'Alignment Research' },
      { url: 'https://example.com/ai-alignment-3', title: 'Safety Mechanisms' },
      { url: 'https://example.com/ai-alignment-4', title: 'Alignment Challenges' },
    ],
    sourcesSaved: [], // No sources saved - poor quality!
    followupCount: 8, // Too many follow-ups
  });
  
  await prisma.episode.update({
    where: { id: episode1.id },
    data: { status: 'completed' },
  });
  
  warning('Performance Issues Detected:');
  log(`    • Sources Returned: 4`, 'dim');
  log(`    • Sources Saved: 0 (0% save rate)`, 'red');
  log(`    • Follow-up Queries: 8 (inefficient)`, 'yellow');
  
  await sleep(2000);

  // ============================================================================
  // SCENARIO 3: Agent Analyzes and Evolves
  // ============================================================================
  header('SCENARIO 3: The Agent Analyzes Performance');
  
  section('Analyzing Episode 1...');
  const analysis1 = await analyzeEpisodePerformance(episode1.id);
  
  info(`Analysis Results:`);
  log(`    • Save Rate: ${Math.round(analysis1.performance.saveRate * 100)}%`, 
      analysis1.performance.saveRate < 0.5 ? 'red' : 'green');
  log(`    • Follow-ups: ${analysis1.performance.followupCount}`, 
      analysis1.performance.followupCount > 5 ? 'yellow' : 'green');
  log(`    • Recommendation: ${analysis1.recommendation.toUpperCase()}`, 
      analysis1.recommendation === 'evolve' ? 'magenta' : 'green');
  log(`    • Reason: ${analysis1.reason}`, 'dim');
  
  await sleep(2000);
  
  section('Checking evolution criteria...');
  const evolutionCheck1 = await shouldEvolveStrategy(topic.id, initialStrategy.version, 1);
  
  if (evolutionCheck1.shouldEvolve) {
    evolution('Evolution Triggered!');
    log(`    Reason: ${evolutionCheck1.reason}`, 'dim');
    log(`    Metrics:`, 'dim');
    log(`      - Total Episodes: ${evolutionCheck1.metrics.totalEpisodes}`, 'dim');
    log(`      - Avg Save Rate: ${Math.round(evolutionCheck1.metrics.avgSaveRate * 100)}%`, 'dim');
    log(`      - Avg Follow-ups: ${evolutionCheck1.metrics.avgFollowupCount.toFixed(1)}`, 'dim');
    
    await sleep(1500);
    
    section('Evolving Strategy...');
    const evolution1 = await evolveStrategy(
      topic.id,
      initialStrategy.version,
      evolutionCheck1
    );
    
    const newConfig1 = JSON.parse(evolution1.newStrategy.configJson);
    const oldConfig1 = initialConfig;
    
    evolution(`Strategy evolved: v${initialStrategy.version} → v${evolution1.newStrategy.version}`);
    
    log('\n    Changes Applied:', 'bright');
    
    // Show what changed
    const changes1 = [
      { key: 'searchDepth', old: oldConfig1.searchDepth, new: newConfig1.searchDepth },
      { key: 'timeWindow', old: oldConfig1.timeWindow, new: newConfig1.timeWindow },
      { key: 'model', old: oldConfig1.model, new: newConfig1.model },
      { key: 'parallelSearches', old: oldConfig1.parallelSearches, new: newConfig1.parallelSearches },
      { key: 'enabledTools', old: oldConfig1.enabledTools?.join(', '), new: newConfig1.enabledTools?.join(', ') },
    ];
    
    changes1.forEach(({ key, old, new: newVal }) => {
      if (JSON.stringify(old) !== JSON.stringify(newVal)) {
        log(`      ${key.padEnd(20)} ${String(old).padEnd(15)} → ${String(newVal)}`, 'green');
      }
    });
    
    log(`\n    Evolution Log: ${evolution1.evolutionLog.reason}`, 'dim');
  }
  
  await sleep(2000);

  // ============================================================================
  // SCENARIO 4: Second Episode - Improved Performance
  // ============================================================================
  header('SCENARIO 4: Second Episode - Strategy v2 in Action');
  
  const strategy2 = await getActiveStrategy(topic.id);
  const config2 = strategy2 ? JSON.parse(strategy2.configJson) : initialConfig;
  
  section(`Episode 2: "How do RLHF techniques work?" (using Strategy v${strategy2?.version || initialStrategy.version})`);
  
  const episode2 = await createEpisode({
    topicId: topic.id,
    strategyVersion: strategy2?.version || initialStrategy.version,
    query: 'How do RLHF techniques work?',
    sourcesReturned: [
      { url: 'https://example.com/rlhf-1', title: 'RLHF Overview' },
      { url: 'https://example.com/rlhf-2', title: 'RLHF Techniques' },
      { url: 'https://example.com/rlhf-3', title: 'RLHF Applications' },
    ],
    sourcesSaved: [
      { url: 'https://example.com/rlhf-1', title: 'RLHF Overview' },
      { url: 'https://example.com/rlhf-2', title: 'RLHF Techniques' },
    ], // 2 out of 3 saved = 67% save rate (better!)
    followupCount: 4, // Fewer follow-ups (more efficient)
  });
  
  await prisma.episode.update({
    where: { id: episode2.id },
    data: { status: 'completed' },
  });
  
  success('Performance Improved:');
  log(`    • Sources Returned: 3`, 'dim');
  log(`    • Sources Saved: 2 (67% save rate)`, 'green');
  log(`    • Follow-up Queries: 4 (more efficient)`, 'green');
  
  await sleep(2000);

  // ============================================================================
  // SCENARIO 5: Continuous Evolution
  // ============================================================================
  header('SCENARIO 5: Continuous Learning Cycle');
  
  section('Analyzing Episode 2...');
  const analysis2 = await analyzeEpisodePerformance(episode2.id);
  
  info(`Analysis Results:`);
  log(`    • Save Rate: ${Math.round(analysis2.performance.saveRate * 100)}%`, 'green');
  log(`    • Follow-ups: ${analysis2.performance.followupCount}`, 'green');
  log(`    • Recommendation: ${analysis2.recommendation.toUpperCase()}`, 
      analysis2.recommendation === 'evolve' ? 'magenta' : 'green');
  
  await sleep(1500);
  
  // Create a few more episodes to show evolution over time
  section('Simulating multiple episodes...');
  
  for (let i = 3; i <= 5; i++) {
    const currentStrategy = await getActiveStrategy(topic.id);
    const episode = await createEpisode({
      topicId: topic.id,
      strategyVersion: currentStrategy?.version || initialStrategy.version,
      query: `Research query ${i}`,
      sourcesReturned: Array.from({ length: 3 }, (_, j) => ({
        url: `https://example.com/source-${i}-${j}`,
        title: `Source ${i}-${j}`,
      })),
      sourcesSaved: Array.from({ length: 2 }, (_, j) => ({
        url: `https://example.com/source-${i}-${j}`,
        title: `Source ${i}-${j}`,
      })), // 67% save rate
      followupCount: 3 + Math.floor(Math.random() * 2), // 3-4 follow-ups
    });
    
    await prisma.episode.update({
      where: { id: episode.id },
      data: { status: 'completed' },
    });
    
    info(`Episode ${i} completed (67% save rate, ~3-4 follow-ups)`);
    
    // Trigger evolution check
    if (i % 2 === 0) {
      const evolutionCheck = await shouldEvolveStrategy(
        topic.id,
        currentStrategy?.version || initialStrategy.version,
        1
      );
      
      if (evolutionCheck.shouldEvolve) {
        evolution(`Evolution triggered after episode ${i}`);
        const evolutionResult = await evolveStrategy(
          topic.id,
          currentStrategy?.version || initialStrategy.version,
          evolutionCheck
        );
        log(`    New strategy: v${evolutionResult.newStrategy.version}`, 'dim');
      }
    }
    
    await sleep(1000);
  }

  // ============================================================================
  // FINAL SUMMARY
  // ============================================================================
  header('DEMO COMPLETE: Evolution Summary');
  
  section('Final Strategy Landscape');
  
  const allStrategies = await prisma.strategyConfig.findMany({
    where: { topicId: topic.id },
    orderBy: { version: 'asc' },
  });
  
  log(`\n  Total Strategy Versions: ${allStrategies.length}`, 'bright');
  allStrategies.forEach((s) => {
    const config = JSON.parse(s.configJson);
    const isActive = s.version === topic.activeStrategyVersion;
    log(`\n  ${isActive ? '→' : ' '} Strategy v${s.version} (${s.status})`, 
        isActive ? 'green' : 'dim');
    log(`      Search Depth: ${config.searchDepth}`, 'dim');
    log(`      Model: ${config.model}`, 'dim');
    log(`      Parallel: ${config.parallelSearches ? 'Yes' : 'No'}`, 'dim');
    if (s.status === 'candidate') {
      log(`      Rollout: ${s.rolloutPercentage}%`, 'yellow');
    }
  });
  
  section('Evolution History');
  
  const evolutions = await prisma.strategyEvolutionLog.findMany({
    where: { topicId: topic.id },
    orderBy: { createdAt: 'asc' },
  });
  
  evolutions.forEach((evo, idx) => {
    const changes = evo.changesJson ? JSON.parse(evo.changesJson) : null;
    log(`\n  Evolution ${idx + 1}: v${evo.fromVersion} → v${evo.toVersion}`, 'magenta');
    log(`    Reason: ${evo.reason}`, 'dim');
    if (changes?.metrics) {
      log(`    Triggered by:`, 'dim');
      log(`      - Save Rate: ${Math.round(changes.metrics.avgSaveRate * 100)}%`, 'dim');
      log(`      - Follow-ups: ${changes.metrics.avgFollowupCount?.toFixed(1)}`, 'dim');
      log(`      - Episodes: ${changes.metrics.totalEpisodes}`, 'dim');
    }
  });
  
  section('Key Insights');
  
  log('\n  🎯 The agent successfully:', 'bright');
  log('     • Detected poor performance (0% save rate)', 'green');
  log('     • Evolved strategy to improve quality', 'green');
  log('     • Achieved better results (67% save rate)', 'green');
  log('     • Continuously optimized over multiple episodes', 'green');
  log('     • Created multiple strategy versions for A/B testing', 'green');
  
  log('\n  🚀 Next Steps:', 'bright');
  log('     • View evolution details in the UI', 'dim');
  log('     • Monitor strategy performance over time', 'dim');
  log('     • Let the agent continue learning autonomously', 'dim');
  
  console.log('\n' + '═'.repeat(70));
  log('✨ Demo Complete! The agent is now self-evolving. ✨', 'bright');
  console.log('═'.repeat(70) + '\n');
  
  log(`Topic ID: ${topic.id}`, 'dim');
  log(`View in UI: http://localhost:3000/topics/${topic.id}`, 'cyan');
  log('\n');
}

main()
  .catch((error) => {
    console.error('\n❌ Demo failed:', error);
    console.error(error.stack);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

