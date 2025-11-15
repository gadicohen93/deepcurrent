# Core Platform & Data Model

This document describes the Core Platform implementation for DeepCurrent - the persistent data layer that enables self-evolving AI research agents.

## Overview

The Core Platform provides a clean, stable, type-safe abstraction over all persistent state in the system:

- **Topics** - Research spaces that organize work
- **StrategyConfigs** - Versioned agent behavior configurations
- **Notes** - User-facing research artifacts
- **Episodes** - Telemetry logs of agent runs
- **StrategyEvolutionLog** - Changelog of agent learning

## Architecture

### Database Setup

- **Database**: SQLite (via LibSQL compatibility)
- **ORM**: Prisma
- **Location**: `./deep-research.db`
- **Schema**: `prisma/schema.prisma`

### Repository Layer

Located in `src/repositories/`:

```
src/repositories/
├── db.ts                  # Prisma client singleton
├── types.ts               # TypeScript types
├── topics.ts              # Topic operations
├── strategies.ts          # Strategy management
├── notes.ts               # Note CRUD
├── episodes.ts            # Episode tracking & metrics
├── evolution-logs.ts      # Evolution history
└── index.ts               # Main export
```

## Data Model

### Topic

A research "space" that ties together strategies, notes, and episodes.

**Key Fields:**
- `id` - Unique identifier
- `title` - Topic name
- `description` - Optional description
- `userId` - Owner (for multi-user support)
- `raindropCollectionId` - Raindrop integration
- `activeStrategyVersion` - Current strategy version

**Relations:**
- Has many `StrategyConfig`
- Has many `Note`
- Has many `Episode`
- Has many `StrategyEvolutionLog`

### StrategyConfig

Versioned agent behavior configuration.

**Key Fields:**
- `id` - Unique identifier
- `topicId` - Parent topic
- `version` - Monotonic version number (per topic)
- `status` - `"active"` | `"candidate"` | `"archived"`
- `rolloutPercentage` - For A/B testing (0-100)
- `parentVersion` - Lineage tracking
- `configJson` - JSON blob with `StrategyConfigPayload`

**StrategyConfigPayload Structure:**
```typescript
{
  tools: {
    senso: boolean;
    airia: boolean;
    raindrop: boolean;
    webSearch: boolean;
  },
  searchStrategy: 'senso-first' | 'web-first' | 'balanced',
  domainWeights?: Record<string, number>,
  summaryFormat?: 'brief' | 'detailed' | 'technical',
  callPatterns?: {
    maxQueries?: number;
    followUpDepth?: number;
    parallelQueries?: boolean;
  }
}
```

### Note

User-facing research artifact.

**Key Fields:**
- `id` - Unique identifier
- `topicId` - Parent topic
- `title` - Note title
- `content` - Markdown content
- `type` - Optional type (`"research"`, `"update"`, `"debug"`)

### Episode

Telemetry log of a single agent run.

**Key Fields:**
- `id` - Unique identifier
- `topicId` - Parent topic
- `userId` - User who triggered
- `strategyVersion` - Which strategy was used
- `query` - User's question
- `sourcesReturned` - JSON array of `SourceRef[]`
- `sourcesSaved` - JSON array of saved sources
- `toolUsage` - Optional JSON tool logs
- `followupCount` - Number of follow-up questions
- `sensoSearchUsed` - Boolean flag
- `sensoGenerateUsed` - Boolean flag
- `resultNoteId` - Associated note

### StrategyEvolutionLog

Changelog of agent learning.

**Key Fields:**
- `id` - Unique identifier
- `topicId` - Parent topic
- `fromVersion` - Previous strategy version
- `toVersion` - New strategy version
- `reason` - Free text explanation
- `changesJson` - JSON diff of config changes

## Usage

### Basic Operations

```typescript
import { topics, strategies, notes, episodes, evolutionLogs } from '@/repositories';

// Get a topic
const topic = await topics.getTopicById('topic-id');

// Get active strategy
const activeStrategy = await strategies.getActiveStrategyWithConfig('topic-id');

// Create a note
const note = await notes.createNote({
  topicId: 'topic-id',
  title: 'Research Summary',
  content: '# Findings...',
  type: 'research',
});

// Record an episode
const episode = await episodes.createEpisode({
  topicId: 'topic-id',
  strategyVersion: 0,
  query: 'What is quantum computing?',
  sourcesReturned: [...],
  sourcesSaved: [...],
  followupCount: 2,
});

// Calculate metrics
const metrics = await episodes.calculateEpisodeMetrics('topic-id');
console.log(`Save rate: ${metrics.avgSaveRate}`);
```

### Strategy Versioning

```typescript
// Create new strategy version
const newStrategy = await strategies.createStrategyVersion({
  topicId: 'topic-id',
  config: {
    tools: { senso: true, airia: true, raindrop: true, webSearch: true },
    searchStrategy: 'senso-first',
    callPatterns: { maxQueries: 5, followUpDepth: 3, parallelQueries: true },
  },
  parentVersion: 0, // Based on v0
  status: 'candidate',
  rolloutPercentage: 20, // A/B test at 20%
});

// Later, promote to active
await strategies.setActiveStrategy('topic-id', newStrategy.version);

// Log the evolution
await evolutionLogs.createEvolutionLog({
  topicId: 'topic-id',
  fromVersion: 0,
  toVersion: newStrategy.version,
  reason: 'Improved metrics: save rate 50% -> 75%',
  changes: { /* diff object */ },
});
```

### Evolution Analysis

```typescript
// Get episodes for analysis
const episodes = await episodes.getEpisodesForEvolution('topic-id', 50);

// Episodes include parsed data and calculated metrics
episodes.forEach(ep => {
  console.log(`Query: ${ep.query}`);
  console.log(`Save rate: ${ep.saveRate}`);
  console.log(`Sources: ${ep.sourcesReturned.length}`);
});

// Get metrics by version
const v0Metrics = await episodes.calculateEpisodeMetrics('topic-id', 0);
const v1Metrics = await episodes.calculateEpisodeMetrics('topic-id', 1);

// Compare
console.log(`v0 save rate: ${v0Metrics.avgSaveRate}`);
console.log(`v1 save rate: ${v1Metrics.avgSaveRate}`);
```

## Available Scripts

```bash
# Database migrations
npm run db:migrate      # Create and apply migrations
npm run db:generate     # Generate Prisma client

# Data management
npm run db:seed         # Populate with sample data
npm run db:test         # Test repository layer
npm run db:studio       # Open Prisma Studio (database GUI)
```

## Database Schema

See `prisma/schema.prisma` for the complete schema definition.

To view the schema visually:
```bash
npm run db:studio
```

## Integration Points

### Mastra Agents

Agents read strategy configs and create episodes:

```typescript
import { strategies, episodes } from '@/repositories';

// In your agent
const strategy = await strategies.getActiveStrategyWithConfig(topicId);
const config = strategy.config;

// Use config to determine behavior
if (config.tools.senso) {
  // Call Senso API
}

// After completion, record episode
await episodes.createEpisode({
  topicId,
  strategyVersion: strategy.version,
  query: userQuery,
  sourcesReturned,
  sourcesSaved,
  // ... other metrics
});
```

### Evolution Engine (Future)

The evolution engine uses episode metrics to create new strategies:

```typescript
import { episodes, strategies, evolutionLogs } from '@/repositories';

// Analyze recent episodes
const recentEpisodes = await episodes.getRecentEpisodes(topicId, 50);
const metrics = await episodes.calculateEpisodeMetrics(topicId);

// Decide if evolution is needed
if (metrics.avgSaveRate < 0.5) {
  // Create improved strategy
  const newStrategy = await strategies.createStrategyVersion({
    topicId,
    config: improvedConfig,
    parentVersion: currentVersion,
    status: 'candidate',
  });

  // Log evolution
  await evolutionLogs.createEvolutionLog({
    topicId,
    fromVersion: currentVersion,
    toVersion: newStrategy.version,
    reason: 'Low save rate detected',
    changes: computeDiff(oldConfig, improvedConfig),
  });
}
```

### UI Integration

The UI can display topics, notes, metrics, and evolution history:

```typescript
import { topics, notes, episodes, evolutionLogs } from '@/repositories';

// Topic workspace
const topic = await topics.getTopicByIdWithRelations(topicId);
const recentNotes = await notes.listNotesForTopic(topicId, 10);
const metrics = await episodes.calculateEpisodeMetrics(topicId);

// Evolution timeline
const timeline = await evolutionLogs.getEvolutionTimeline(topicId);
```

## Testing

Run the test script to verify the repository layer:

```bash
npm run db:test
```

This will:
1. List all topics
2. Display active strategy
3. Show all strategy versions
4. List notes
5. Show recent episodes
6. Calculate metrics
7. Display evolution logs

## Sample Data

To populate the database with sample data:

```bash
npm run db:seed
```

This creates:
- 1 Topic: "Self-evolving AI Agents"
- 2 StrategyConfigs: v0 (active) and v1 (candidate)
- 1 Note: Initial research summary
- 2 Episodes: Sample agent runs
- 1 EvolutionLog: v0 → v1 transition

## Next Steps

1. **Integrate with Mastra workflows** - Update workflows to use repositories
2. **Build evolution engine** - Automate strategy improvement
3. **Create UI components** - Display topics, notes, metrics
4. **Add API endpoints** - Expose data to frontend
5. **Implement A/B testing** - Use rolloutPercentage for experiments

## Files Created

### Core Files
- `prisma/schema.prisma` - Database schema
- `prisma.config.ts` - Prisma configuration
- `src/repositories/db.ts` - Prisma client
- `src/repositories/types.ts` - TypeScript types
- `src/repositories/topics.ts` - Topic repository
- `src/repositories/strategies.ts` - Strategy repository
- `src/repositories/notes.ts` - Note repository
- `src/repositories/episodes.ts` - Episode repository
- `src/repositories/evolution-logs.ts` - Evolution log repository
- `src/repositories/index.ts` - Main export

### Scripts
- `scripts/seed-db.ts` - Database seeding
- `scripts/test-repositories.ts` - Repository testing

### Database
- `deep-research.db` - SQLite database
- `prisma/migrations/` - Migration history

## Troubleshooting

### Prisma Client not found
```bash
npm run db:generate
```

### Database schema out of sync
```bash
npm run db:migrate
```

### Reset database
```bash
rm deep-research.db
npm run db:migrate
npm run db:seed
```
