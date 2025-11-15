/**
 * Database Seed Script
 *
 * Populates the database with initial sample data for DeepCurrent.
 *
 * Usage:
 *   npx tsx scripts/seed-db.ts
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
import type { StrategyConfigPayload } from '../src/repositories/types';

async function main() {
  console.log('🌱 Seeding database...\n');

  // Create a sample topic
  console.log('Creating topic: Self-evolving AI Agents');
  const topic = await topics.createTopic({
    title: 'Self-evolving AI Agents',
    description: 'Research on autonomous agents that improve their own behavior over time',
    userId: 'demo-user',
  });
  console.log(`✓ Created topic: ${topic.id}\n`);

  // Create initial strategy (v0)
  console.log('Creating initial strategy (v0)...');
  const initialConfig: StrategyConfigPayload = {
    tools: {
      senso: true,
      airia: false,
      raindrop: true,
      webSearch: true,
    },
    searchStrategy: 'web-first',
    domainWeights: {
      'arxiv.org': 1.5,
      'github.com': 1.2,
      'medium.com': 0.8,
    },
    summaryFormat: 'detailed',
    callPatterns: {
      maxQueries: 3,
      followUpDepth: 2,
      parallelQueries: false,
    },
  };

  const strategyV0 = await strategies.createStrategyVersion({
    topicId: topic.id,
    config: initialConfig,
    status: 'active',
    rolloutPercentage: 100,
  });
  console.log(`✓ Created strategy v${strategyV0.version}\n`);

  // Set as active
  await topics.updateTopic(topic.id, {
    activeStrategyVersion: strategyV0.version,
  });
  console.log(`✓ Set v${strategyV0.version} as active\n`);

  // Create a sample note
  console.log('Creating sample note...');
  const note = await notes.createNote({
    topicId: topic.id,
    title: 'Initial Research Summary',
    content: `# Self-evolving AI Agents

## Overview
Self-evolving AI agents represent a paradigm shift in autonomous systems. These agents can:
- Monitor their own performance
- Identify areas for improvement
- Modify their behavior autonomously

## Key Findings
1. **Feedback loops** are essential for continuous improvement
2. **Telemetry** provides the data needed for evolution
3. **Version control** of strategies enables A/B testing

## Next Steps
- Implement metrics collection
- Build evolution engine
- Test candidate strategies
`,
    type: 'research',
  });
  console.log(`✓ Created note: ${note.id}\n`);

  // Create sample episodes
  console.log('Creating sample episodes...');
  const episode1 = await episodes.createEpisode({
    topicId: topic.id,
    strategyVersion: strategyV0.version,
    query: 'What are the latest papers on self-evolving agents?',
    sourcesReturned: [
      {
        url: 'https://arxiv.org/abs/2024.12345',
        title: 'Autonomous Agent Evolution',
        source: 'web',
        snippet: 'Recent advances in self-modifying AI systems...',
      },
      {
        url: 'https://github.com/example/agent-evolution',
        title: 'Agent Evolution Framework',
        source: 'web',
        snippet: 'Open-source framework for building evolving agents...',
      },
    ],
    sourcesSaved: [
      {
        url: 'https://arxiv.org/abs/2024.12345',
        title: 'Autonomous Agent Evolution',
        source: 'raindrop',
      },
    ],
    followupCount: 2,
    resultNoteId: note.id,
    sensoSearchUsed: false,
    sensoGenerateUsed: false,
  });
  console.log(`✓ Created episode 1: ${episode1.id}`);

  const episode2 = await episodes.createEpisode({
    topicId: topic.id,
    strategyVersion: strategyV0.version,
    query: 'How do agents measure their own performance?',
    sourcesReturned: [
      {
        url: 'https://arxiv.org/abs/2024.67890',
        title: 'Metrics for AI Agent Performance',
        source: 'web',
        snippet: 'Comprehensive framework for evaluating agent behavior...',
      },
    ],
    sourcesSaved: [
      {
        url: 'https://arxiv.org/abs/2024.67890',
        title: 'Metrics for AI Agent Performance',
        source: 'raindrop',
      },
    ],
    followupCount: 1,
    resultNoteId: note.id,
    sensoSearchUsed: true,
    sensoGenerateUsed: false,
  });
  console.log(`✓ Created episode 2: ${episode2.id}\n`);

  // Create an improved strategy (v1)
  console.log('Creating improved strategy (v1)...');
  const improvedConfig: StrategyConfigPayload = {
    ...initialConfig,
    tools: {
      ...initialConfig.tools,
      senso: true, // Enable Senso based on good results
      airia: true, // Add Airia
    },
    searchStrategy: 'senso-first', // Switch to Senso-first
    callPatterns: {
      maxQueries: 5, // Increase based on user engagement
      followUpDepth: 3,
      parallelQueries: true, // Enable parallel queries
    },
  };

  const strategyV1 = await strategies.createStrategyVersion({
    topicId: topic.id,
    config: improvedConfig,
    parentVersion: strategyV0.version,
    status: 'candidate',
    rolloutPercentage: 20,
  });
  console.log(`✓ Created strategy v${strategyV1.version}\n`);

  // Log the evolution
  console.log('Creating evolution log...');
  const evolutionLog = await evolutionLogs.createEvolutionLog({
    topicId: topic.id,
    fromVersion: strategyV0.version,
    toVersion: strategyV1.version,
    reason: 'Improved performance metrics: higher save rate (50% -> 75%), increased user engagement',
    changes: {
      tools: {
        added: ['airia'],
        enabled: ['senso'],
      },
      searchStrategy: {
        from: 'web-first',
        to: 'senso-first',
      },
      callPatterns: {
        maxQueries: { from: 3, to: 5 },
        followUpDepth: { from: 2, to: 3 },
        parallelQueries: { from: false, to: true },
      },
    },
  });
  console.log(`✓ Created evolution log: ${evolutionLog.id}\n`);

  console.log('✅ Seeding complete!\n');
  console.log('Summary:');
  console.log(`  - Topic: "${topic.title}" (${topic.id})`);
  console.log(`  - Strategies: v${strategyV0.version} (active), v${strategyV1.version} (candidate)`);
  console.log(`  - Notes: 1`);
  console.log(`  - Episodes: 2`);
  console.log(`  - Evolution Logs: 1\n`);
}

main()
  .catch((error) => {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await disconnectPrisma();
  });
