/**
 * Script to add default strategies to existing topics
 * 
 * Run with: npx tsx scripts/add-default-strategies.ts
 */

import { prisma } from '../src/repositories/db';
import { createDefaultStrategy } from '../src/repositories/strategies';

async function main() {
  console.log('Adding default strategies to existing topics...\n');

  // Get all topics
  const topics = await prisma.topic.findMany({
    include: {
      strategyConfigs: true,
    },
  });

  console.log(`Found ${topics.length} topics`);

  for (const topic of topics) {
    if (topic.strategyConfigs.length === 0) {
      console.log(`  Creating default strategy for: ${topic.title}`);
      const strategy = await createDefaultStrategy(topic.id);
      
      // Set as active strategy version
      await prisma.topic.update({
        where: { id: topic.id },
        data: { activeStrategyVersion: strategy.version },
      });
      
      console.log(`    ✓ Created strategy v${strategy.version}`);
    } else {
      console.log(`  Skipping ${topic.title} (already has ${topic.strategyConfigs.length} strategies)`);
    }
  }

  console.log('\n✓ Done!');
}

main()
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

