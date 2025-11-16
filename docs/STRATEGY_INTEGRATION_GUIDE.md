# Strategy Integration & Evolution Guide

## Two Approaches for Strategy Evolution

### Approach 1: Background Hook (Current Implementation)
**Pros:** Simple, doesn't block research response  
**Cons:** No visibility into evolution process, runs detached

```typescript
// src/lib/runResearchStreaming.ts
await updateEpisodeStatus(episodeId, 'completed', { ... });

// Post-episode analysis runs in background (fire and forget)
postEpisodeAnalysis(episodeId).catch(console.error);
```

### Approach 2: Integrated Workflow (Recommended)
**Pros:** Trackable, can stream evolution events, integrated logging  
**Cons:** Slightly slower (but user gets visibility)

```typescript
// Use the selfEvolvingResearchWorkflow instead
const workflow = mastra.getWorkflow('selfEvolvingResearchWorkflow');
const run = await workflow.execute({
  topicId,
  episodeId,
  query
});

// Evolution happens as a workflow step
// → Load Strategy
// → Execute Research
// → Analyze Performance
// → Evolve Strategy (if needed)
```

## How Strategy Config Is Passed to Agent & Tools

### 1. Load Strategy from Database

```typescript
// Load active strategy
const activeStrategy = await getActiveStrategy(topicId);
const strategyConfig = JSON.parse(activeStrategy.configJson);

// {
//   searchDepth: 'deep',
//   timeWindow: 'month',
//   maxFollowups: 5,
//   sensoFirst: true
// }
```

### 2. Pass via Runtime Context

```typescript
// Call agent with strategy config
const stream = await researchAgent.streamVNext(query, {
  format: 'aisdk',
  runtimeContext: {
    strategyVersion: activeStrategy.version,
    searchDepth: strategyConfig.searchDepth,    // ← Tools can read this!
    timeWindow: strategyConfig.timeWindow,
    maxFollowups: strategyConfig.maxFollowups,
    topicId,
    episodeId,
  }
});
```

### 3. Tools Access Runtime Context

```typescript
// src/mastra/tools/linkupSearchToolEnhanced.ts
export const linkupSearchToolEnhanced = createTool({
  id: 'linkup-search-enhanced',
  execute: async ({ context, mastra, runtimeContext }) => {
    
    // ✅ Read strategy configuration!
    const strategy = runtimeContext as any;
    const searchDepth = strategy?.searchDepth || 'standard';
    
    // ✅ Adapt behavior based on strategy
    const resultCount = searchDepth === 'deep' ? 5 : 
                        searchDepth === 'shallow' ? 2 : 3;
    
    const results = await linkup.search({
      query,
      depth: searchDepth === 'deep' ? 'deep' : 'standard',
    });
    
    return {
      results: results.slice(0, resultCount),
      strategyApplied: { searchDepth, resultCount }
    };
  }
});
```

## Current Implementation Status

### ✅ What's Working Now:

1. **Strategy Loading**: ✅ Loads from database
2. **Prompt Customization**: ✅ Adjusts agent prompt based on strategy
3. **Runtime Context**: ✅ Passed to agent execution
4. **Agent Instructions**: ✅ Agent knows to respect strategy limits
5. **Performance Tracking**: ✅ Episodes record metrics
6. **Automatic Analysis**: ✅ Runs after episodes complete

### 🔄 What Needs Enhancement:

1. **Tool-Level Adaptation**: Tools need to read `runtimeContext` (example provided)
2. **Workflow Integration**: Use workflow approach for better tracking
3. **Evolution Streaming**: Stream evolution events to UI
4. **Strategy Validation**: Test evolved strategies automatically

## Quick Implementation: Use Workflow Approach

### Step 1: Update streaming endpoint to use workflow

```typescript
// app/api/topics/[id]/ask/stream/route.ts
import { mastra } from '@/mastra';

// Inside the stream start function:
const workflow = mastra.getWorkflow('selfEvolvingResearchWorkflow');

const run = workflow.createRun();
const result = await run.execute({
  topicId,
  episodeId: episode.id,
  query,
});

// Stream workflow execution
for await (const event of result.stream) {
  switch (event.type) {
    case 'step_start':
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ 
          type: 'status', 
          status: event.stepId,
          message: `Step: ${event.stepId}`
        })}\n\n`)
      );
      break;
    
    case 'step_complete':
      if (event.stepId === 'evolve-strategy') {
        // Strategy evolved!
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ 
            type: 'strategy_evolved', 
            newVersion: event.result.newStrategyVersion,
            reason: event.result.reason
          })}\n\n`)
        );
      }
      break;
  }
}
```

### Step 2: Enhance Tools to Use Runtime Context

Replace tools one by one:
- ✅ `linkupSearchToolEnhanced.ts` - Example provided
- ⏳ `evaluateResultsBatchTool.ts` - Adapt evaluation criteria
- ⏳ `extractLearningsTool.ts` - Adapt extraction depth

Pattern:
```typescript
execute: async ({ context, mastra, runtimeContext }) => {
  const strategy = runtimeContext as { searchDepth?: string; maxFollowups?: number };
  
  // Adapt behavior
  if (strategy?.searchDepth === 'shallow') {
    // Be quick and focused
  } else if (strategy?.searchDepth === 'deep') {
    // Be thorough
  }
}
```

### Step 3: Add Evolution Event Type

```typescript
// lib/api/research.ts
export type ResearchStreamEvent =
  | ... existing events ...
  | { 
      type: 'strategy_evolved'; 
      fromVersion: number;
      toVersion: number;
      reason: string;
      changes: Record<string, any>;
    };
```

## Architecture Decision: Workflow vs Hook

### Recommendation: **Use Workflow for Evolution**

**Why?**
1. ✅ **Trackable** - Evolution becomes a visible workflow step
2. ✅ **Streamable** - Can send evolution events to UI in real-time
3. ✅ **Resumable** - Can pause/resume evolution process
4. ✅ **Testable** - Easier to test evolution logic
5. ✅ **Observable** - Full tracing and logging

**When to use Hook:**
- Background cleanup tasks
- Optional analytics
- Non-critical operations

**When to use Workflow:**
- Core business logic (like strategy evolution!)
- Operations that affect user experience
- Operations that need monitoring

## Current State

### What You Have Now:

```
User asks question
    ↓
Load Strategy v2 ✅
    ↓
Pass to agent as runtimeContext ✅
    ↓
Agent sees strategy in prompt ✅
    ↓
Tools execute (need enhancement) ⏳
    ↓
Record metrics ✅
    ↓
Background: Analyze & evolve ✅
```

### What It Should Be (Workflow):

```
User asks question
    ↓
[Workflow Step 1] Load Strategy
    ↓
[Workflow Step 2] Execute Research
    ↓
[Workflow Step 3] Analyze Performance
    ↓
[Workflow Step 4 - Conditional] Evolve Strategy
    ├─ Yes → Create v3, log evolution
    └─ No → Done
    ↓
Stream all steps to UI ✨
```

## Next Steps to Complete Integration

1. **Switch to workflow approach**:
   - Use `selfEvolvingResearchWorkflow` in streaming endpoint
   - Remove background hook
   - Stream workflow events

2. **Enhance tools to read runtime context**:
   - Update `linkupSearchTool` → use enhanced version
   - Update `evaluateResultsBatchTool` → adapt criteria
   - Update `extractLearningsTool` → adapt depth

3. **Add evolution events to UI**:
   - Add `strategy_evolved` event type
   - Show evolution notification in real-time
   - Update LiveAgentBrainPanel to display it

4. **Test the loop**:
   - Run 5 queries with poor performance
   - Watch strategy evolve in workflow step
   - Verify v2 is used in next query
   - See improved metrics

## Key Files

**Core Evolution Logic:**
- `src/lib/strategyEvolution.ts` - Analysis & evolution functions
- `src/mastra/workflows/selfEvolvingResearchWorkflow.ts` - Workflow with evolution
- `src/repositories/strategies.ts` - Strategy CRUD

**Integration:**
- `src/lib/runResearchStreaming.ts` - Current streaming (uses hook)
- `src/mastra/tools/linkupSearchToolEnhanced.ts` - Example strategy-aware tool
- `src/mastra/agents/strategyRuntimeContext.ts` - Type definitions

**UI:**
- `components/agent/LiveAgentBrainPanel.tsx` - Shows strategy & evolution
- `components/agent/StrategyEvolutionAlert.tsx` - Evolution notifications

## The Answer to Your Question

> "Should it be something that runs on the backend from the agent?"

**YES!** Strategy evolution should be **integrated as a workflow step** on the backend, not a detached background hook. This gives you:

✅ Full visibility  
✅ Real-time streaming  
✅ Error handling  
✅ Tracing & observability  
✅ State management  

The workflow approach makes evolution a **first-class citizen** of your agent system, not an afterthought.

---

**Next Action:** Replace background hook with workflow execution for proper integration! 🚀

