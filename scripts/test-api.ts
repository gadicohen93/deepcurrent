/**
 * Quick API Integration Test
 *
 * Tests the topics API endpoints to ensure they're working correctly.
 */

import { listTopics, getTopicByIdWithRelations } from '../src/repositories/topics';

async function testAPI() {
  console.log('🧪 Testing Topics API Integration\n');

  try {
    // Test 1: List all topics
    console.log('Test 1: Fetching all topics...');
    const topics = await listTopics();
    console.log(`✓ Found ${topics.length} topic(s)`);
    topics.forEach((topic) => {
      console.log(`  - ${topic.title} (${topic.id})`);
    });
    console.log();

    if (topics.length === 0) {
      console.log('⚠️  No topics found. Run `npm run db:seed` first.\n');
      return;
    }

    // Test 2: Get topic with relations
    const topicId = topics[0].id;
    console.log(`Test 2: Fetching topic ${topicId} with relations...`);
    const topicWithRelations = await getTopicByIdWithRelations(topicId);
    console.log(`✓ Topic: ${topicWithRelations?.title}`);
    console.log(`  - Strategies: ${topicWithRelations?.strategyConfigs.length}`);
    console.log(`  - Notes: ${topicWithRelations?.notes.length}`);
    console.log(`  - Episodes: ${topicWithRelations?.episodes.length}`);
    console.log(`  - Evolution Logs: ${topicWithRelations?.evolutionLogs.length}`);
    console.log();

    console.log('✅ All repository tests passed!\n');
    console.log('📋 Next steps:');
    console.log('   1. Start the dev server: npm run dev');
    console.log('   2. Open http://localhost:3000/topics');
    console.log('   3. Verify the UI shows the seeded data\n');
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testAPI();
