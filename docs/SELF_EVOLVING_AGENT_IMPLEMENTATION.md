# Self-Evolving Agent Implementation

## Overview

We've implemented a complete self-evolving agent system where the research agent automatically improves its strategy based on performance metrics.

## How It Works

### 1. Strategy-Driven Execution

**When a research query runs:**
1. Loads the active strategy configuration from the database
2. Customizes the agent prompt based on strategy settings:
   - `searchDepth`: 'deep' or 'shallow' - controls thoroughness
   - `timeWindow`: 'day', 'week', 'month' - controls time scope
   - `summaryTemplates`: ['bullets', 'narrative'] - controls output format
3. Displays strategy version in UI: "🧠 Using strategy v2"

**Files:**
- `src/lib/runResearchStreaming.ts` - Loads and applies strategy
- `src/repositories/strategies.ts` - Strategy CRUD operations

### 2. Episode Tracking & Metrics

**During execution:**
- Tracks all tool calls and results
- Records sources returned vs sources saved
- Counts follow-up queries
- Measures completion time

**After completion:**
- Saves episode with full telemetry
- Calculates save rate (quality metric)
- Records tool usage patterns

**Files:**
- `src/repositories/episodes.ts` - Episode operations
- Database schema: `Episode` model with status tracking

### 3. Automatic Strategy Evolution

**Post-Episode Analysis (runs in background):**

```typescript
// After every episode completes
await postEpisodeAnalysis(episodeId)
```

**Analysis checks:**
- **Save Rate** < 40% → Strategy needs improvement
- **Average Follow-ups** > 8 → Strategy is inefficient  
- **Senso Usage** < 20% → Enable senso-first mode

**Evolution triggers after 5 episodes:**
1. Calculates aggregate metrics for current strategy
2. If performance is poor, evolves the strategy:
   - Low save rate → Switch to 'deep' search, expand time window
   - Too many followups → Switch to 'shallow' search, limit followups
   - Low senso usage → Enable senso-first mode
3. Creates new strategy version as 'candidate' (20% rollout)
4. Logs evolution reason in `StrategyEvolutionLog`

**Files:**
- `src/lib/strategyEvolution.ts` - Evolution logic
- Functions:
  - `analyzeEpisodePerformance()` - Single episode analysis
  - `shouldEvolveStrategy()` - Checks if evolution needed
  - `evolveStrategy()` - Creates new strategy version
  - `postEpisodeAnalysis()` - Main hook

### 4. Strategy Versioning & A/B Testing

**Strategy lifecycle:**
1. **v1 (Active, 100%)** - Initial default strategy
2. **v2 (Candidate, 20%)** - New evolved strategy being tested
3. After validation → v2 becomes Active (100%)
4. **v1 (Archived)** - Old strategy preserved for rollback

**Database schema:**
```prisma
model StrategyConfig {
  version           Int
  status            String  // "active" | "candidate" | "archived"
  rolloutPercentage Int
  parentVersion     Int?    // Lineage tracking
  configJson        String  // Strategy configuration
}
```

### 5. UI Integration

**LiveAgentBrainPanel shows:**
- Current strategy version and status
- Real-time execution metrics during research
- Performance history from past episodes
- Evolution notifications

**StrategyEvolutionAlert component:**
- Shows notifications when strategy evolves
- Displays evolution reason
- Shows version changes (v1 → v2)

## Quick Start

### 1. Add Default Strategies to Existing Topics

```bash
npx tsx scripts/add-default-strategies.ts
```

### 2. Run Research

When you ask a research question, the system will:
1. Load strategy v1
2. Execute with strategy-specific behavior
3. Track all metrics
4. Analyze performance after completion

### 3. See Evolution in Action

After 5+ episodes with poor performance, check:
- Database: `StrategyEvolutionLog` table
- UI: Evolution alerts in LiveAgentBrainPanel
- Console: "Evolving strategy for topic X: [reason]"

## Configuration

Default strategy (`createDefaultStrategy`):
```typescript
{
  tools: ['linkupSearchTool', 'evaluateResultsBatchTool', 'extractLearningsTool'],
  sensoFirst: false,
  summaryTemplates: ['bullets', 'narrative'],
  timeWindow: 'week',
  searchDepth: 'standard'
}
```

Evolution thresholds (`strategyEvolution.ts`):
```typescript
- minEpisodes: 5          // Episodes before evolving
- lowSaveRate: 0.4        // Trigger threshold
- highFollowups: 8        // Trigger threshold
- candidateRollout: 20%   // A/B test percentage
```

## API Endpoints

```typescript
GET  /api/topics/:id/evolutions      // List evolution history
GET  /api/topics/:id/with-relations  // Topic with strategies
POST /api/topics                      // Creates topic + default strategy
```

## Future Enhancements

1. **Multi-armed bandit** - Intelligent A/B testing with automatic winner selection
2. **Fitness functions** - More sophisticated performance metrics
3. **Strategy templates** - Pre-built strategies for different domains
4. **Manual overrides** - UI for manual strategy adjustments
5. **Evolution scheduling** - Time-based or episode-based evolution triggers
6. **Rollback mechanism** - Automatic rollback on performance degradation

## Files Created/Modified

### New Files:
- `src/lib/strategyEvolution.ts` - Evolution logic
- `src/repositories/strategies.ts` - Strategy operations
- `components/agent/LiveAgentBrainPanel.tsx` - Live execution UI
- `components/agent/StrategyEvolutionAlert.tsx` - Evolution notifications
- `scripts/add-default-strategies.ts` - Migration script
- `app/api/topics/[id]/evolutions/route.ts` - Evolution API

### Modified Files:
- `src/lib/runResearchStreaming.ts` - Strategy loading & application
- `app/api/topics/route.ts` - Auto-create strategies
- `app/topics/[id]/page.tsx` - Use LiveAgentBrainPanel

## Database Schema

Already in place:
- ✅ `StrategyConfig` - Strategy versions
- ✅ `StrategyEvolutionLog` - Evolution history
- ✅ `Episode` - Execution telemetry
- ✅ Relations and indexes

## Testing

1. Create a topic
2. Run 5+ queries with poor results (to trigger evolution)
3. Check console for "Evolving strategy..." message
4. View evolution in database or UI
5. Next query will use evolved strategy

## Monitoring

Watch for evolution in logs:
```
Episode X analysis: { recommendation: 'evolve', reason: '...' }
Evolving strategy for topic Y: Low save rate...
Created new strategy v2
```

Check LiveAgentBrainPanel for:
- Strategy version badge
- Live metrics during execution
- Evolution notifications

---

**The agent now truly evolves!** 🧠✨

