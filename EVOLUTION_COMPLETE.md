# ✅ Self-Evolving Agent System - COMPLETE

## 🎉 What We Built

A fully integrated self-evolving agent system where:
1. **Strategies control agent behavior** (search depth, time window, followup limits)
2. **Tools adapt dynamically** based on strategy configuration  
3. **Performance is tracked** via episode metrics
4. **Automatic evolution** creates new strategies when performance is poor
5. **UI shows everything** in real-time with beautiful visualizations

---

## 🔄 The Complete Evolution Loop

```
┌─────────────────────────────────────────────────────────┐
│  1. USER ASKS QUESTION                                  │
│     "What are self-evolving agents?"                    │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  2. LOAD STRATEGY FROM DATABASE                         │
│     ✓ Get active strategy (v2)                          │
│     ✓ Parse config: { searchDepth: 'deep', ... }        │
│     ✓ Display in UI: "🧠 Using strategy v2"             │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  3. EXECUTE RESEARCH WITH STRATEGY                      │
│     ✓ Agent gets strategy in instructions               │
│     ✓ Tools receive runtimeContext with strategy        │
│     ✓ LinkUp: Uses 'deep' mode, returns 5 results       │
│     ✓ Evaluate: Inclusive criteria for deep search      │
│     ✓ Extract: Up to 2 followups per result             │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  4. TRACK PERFORMANCE METRICS                           │
│     ✓ Sources returned: 12                              │
│     ✓ Sources saved: 3                                  │
│     ✓ Save rate: 25% (LOW!)                             │
│     ✓ Followup count: 15 (HIGH!)                        │
│     ✓ Status: completed                                 │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  5. ANALYZE AFTER 5+ EPISODES                           │
│     ✓ Calculate avg save rate: 25%                      │
│     ✓ Calculate avg followups: 14                       │
│     ✓ Trigger: LOW SAVE RATE (<40%)                     │
│     ✓ Decision: EVOLVE STRATEGY                         │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  6. AUTOMATIC STRATEGY EVOLUTION                        │
│     ✓ Low save rate → Switch to 'shallow' search        │
│     ✓ High followups → Add maxFollowups: 3              │
│     ✓ Low senso usage → Enable sensoFirst: true         │
│     ✓ Create v3 as 'candidate' (20% rollout)            │
│     ✓ Log evolution reason                              │
│     ✓ Stream 🧬 evolution event to UI                   │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  7. NEXT QUERY USES EVOLVED STRATEGY                    │
│     "What are applications of self-evolving agents?"    │
│     → Uses v3: shallow search, max 3 followups          │
│     → Better performance expected!                      │
└─────────────────────────────────────────────────────────┘
```

---

## 🚀 How To Use

### Option 1: Workflow Mode (Full Integration)
```bash
# Enable workflow mode
export USE_WORKFLOW=true

# Start the app
npm run dev
```

Features:
- ✅ Strategy evolution as workflow step
- ✅ Real-time evolution notifications
- ✅ Full observability
- ⚠️ Slightly slower (evolution happens synchronously)

### Option 2: Streaming Mode (Current Default)
```bash
# Workflow mode disabled (default)
npm run dev
```

Features:
- ✅ Fast streaming with tool details
- ✅ Evolution runs in background
- ✅ Rich UI with search/evaluation/learning cards
- ⚠️ Evolution happens async (no immediate notification)

**Recommendation:** Use **Streaming Mode** for production, it gives you the best UX!

---

## 📊 What You'll See in the UI

### During Research:

**Left Panel - Research Stream:**
- 🔍 **Search cards** - "Found 3 results for: applications of AI agents"
  - Shows clickable URLs
- ⚖️ **Evaluation cards** - "Evaluated 3 results → 2 relevant"
  - Shows relevance reasons
- 💡 **Learning cards** - "Key insight: ... → Follow-up: ..."
  - Shows extracted insights
- 📝 **Markdown content** - Beautifully rendered research report
- 🧬 **Evolution alert** (if strategy evolved) - "v1 → v2: Low save rate (25%)"

**Right Panel - Agent Brain:**
- 🧠 **Live Status** (when running)
  - Current phase
  - Recent tool calls  
  - Live metrics (searches, relevant, insights)
- ⚙️ **Strategy Config**
  - Active version & status
  - Tools, search depth, time window
- 📈 **Performance Metrics**
  - Episodes, fitness, save rate

---

## 🔧 Strategy Configuration Format

```typescript
{
  // Tool selection
  tools: ['linkupSearchTool', 'evaluateResultsBatchTool', 'extractLearningsTool'],
  
  // Search behavior
  searchDepth: 'shallow' | 'standard' | 'deep',    // Controls thoroughness
  timeWindow: 'day' | 'week' | 'month' | 'all',    // Temporal scope
  
  // Quality controls
  sensoFirst: false,                                 // Prioritize knowledge base
  maxFollowups: 3,                                  // Limit follow-up queries
  
  // Output formatting
  summaryTemplates: ['bullets', 'narrative']         // Output style
}
```

### How Tools Adapt:

| Tool | shallow | standard | deep |
|------|---------|----------|------|
| **LinkUp** | 2 results | 3 results | 5 results |
| | Brief summaries | Concise summaries | Detailed summaries |
| **Evaluate** | Selective | Balanced | Inclusive |
| | Only high-quality | Standard criteria | Accept potentially relevant |
| **Extract** | 0 followups | 1 followup | 2 followups |
| | No questions | 1 question/result | 2 questions/result |

---

## 📈 Evolution Triggers

| Metric | Threshold | Action |
|--------|-----------|--------|
| **Save Rate** | < 40% | → `searchDepth: 'shallow'`<br>→ `timeWindow: 'month'` |
| **Followups** | > 8 avg | → `maxFollowups: 3`<br>→ `searchDepth: 'shallow'` |
| **Senso Usage** | < 20% | → `sensoFirst: true` |

**Minimum Episodes:** 5 (configurable)

---

## 🧪 Testing

### Run the Evolution Test:
```bash
npx tsx scripts/test-strategy-evolution.ts
```

This will:
1. Create a test topic with strategy v1
2. Create 6 mock episodes with poor performance
3. Trigger automatic evolution
4. Create strategy v2 with improved configuration
5. Verify all database records

### Test in Live App:
1. Create a new topic
2. Ask 5+ research questions
3. Make them fail (nonsense queries) or perform poorly
4. After 5th episode, check console for "Evolving strategy..."
5. See v2 created in database
6. Next query uses v2!

---

## 🎯 Key Files Modified/Created

### Core Evolution System:
✅ `src/lib/strategyEvolution.ts` - Evolution logic (analyze, decide, evolve)  
✅ `src/repositories/strategies.ts` - Strategy CRUD operations  
✅ `src/lib/runResearchStreaming.ts` - Loads & applies strategy + runtime context  
✅ `src/lib/runResearchWorkflow.ts` - Workflow-based execution with evolution  
✅ `src/mastra/workflows/selfEvolvingResearchWorkflow.ts` - Complete workflow

### Strategy-Aware Tools:
✅ `src/mastra/tools/linkupSearchTool.ts` - Reads runtime context, adapts search  
✅ `src/mastra/tools/evaluateResultsBatchTool.ts` - Adapts evaluation criteria  
✅ `src/mastra/tools/extractLearningsTool.ts` - Respects followup limits  
📝 `src/mastra/tools/linkupSearchToolEnhanced.ts` - Reference implementation

### UI Components:
✅ `components/agent/LiveAgentBrainPanel.tsx` - Shows live execution + strategy  
✅ `components/topic/StreamingNoteCard.tsx` - Rich tool details + evolution alert  
✅ `components/topic/NoteCard.tsx` - Markdown rendering  
✅ `components/agent/StrategyEvolutionAlert.tsx` - Evolution notifications  
✅ `hooks/useStreamingResearch.ts` - Handles all event types

### API & Types:
✅ `lib/api/research.ts` - Event types including `strategy_evolved`  
✅ `app/api/topics/route.ts` - Auto-creates strategies  
✅ `app/api/topics/[id]/ask/stream/route.ts` - Dual-mode streaming  
✅ `app/api/topics/[id]/evolutions/route.ts` - Evolution history API

### Scripts:
✅ `scripts/add-default-strategies.ts` - Migrate existing topics  
✅ `scripts/test-strategy-evolution.ts` - End-to-end test

### Docs:
✅ `docs/SELF_EVOLVING_AGENT_IMPLEMENTATION.md` - Architecture overview  
✅ `docs/STRATEGY_INTEGRATION_GUIDE.md` - Integration patterns  
✅ `EVOLUTION_COMPLETE.md` - This file!

---

## 🎮 Usage

### Start Research (Auto-uses Strategy):
```typescript
// Just ask a question - strategy is automatic!
POST /api/topics/:topicId/ask/stream
{ "query": "What are self-evolving agents?" }

// Backend automatically:
// 1. Loads active strategy
// 2. Passes to agent via runtimeContext
// 3. Tools adapt behavior
// 4. Tracks metrics
// 5. Evolves if needed
```

### Monitor Evolution:
```typescript
// Get evolution history
GET /api/topics/:topicId/evolutions

// Response:
[
  {
    "fromVersion": 1,
    "toVersion": 2,
    "reason": "Auto-evolved: Low save rate (25%)",
    "timestamp": "2025-11-16T00:07:52Z"
  }
]
```

---

## 📊 Verified Features

✅ **Strategy Loading** - Loads from database  
✅ **Runtime Context** - Passes to agent & tools  
✅ **Tool Adaptation** - Tools read & respect config  
✅ **Metric Tracking** - Episodes record performance  
✅ **Automatic Analysis** - Runs after episodes  
✅ **Evolution Logic** - Creates new strategies  
✅ **A/B Testing** - Candidate vs active versioning  
✅ **UI Integration** - Shows everything in real-time  
✅ **Workflow Mode** - Full workflow integration available  
✅ **Database Schema** - All tables & relations  

---

## 🔮 What Happens Next

### Immediate:
- Strategy v2 (candidate at 20%) will be used for 20% of queries
- You can manually promote it to 100% via `setActiveStrategy(topicId, 2)`

### After More Episodes:
- System continues learning
- If v2 also performs poorly → creates v3
- If v2 performs well → can promote to 100%
- Builds lineage: v1 → v2 → v3 → v4...

### Evolution Patterns:
- **Low save rate** → More focused search (shallow) + wider time (month)
- **High followups** → Constrain followups (maxFollowups: 3)
- **Low tool usage** → Enable alternative tools (sensoFirst)

---

## 🎨 UI Experience

**Before:** "Research running..."  
**Now:** 
- "🧠 Using strategy v2 (shallow search)"
- "🔍 Search: applications of AI → 2 results"
- "⚖️ Evaluated 2 results → 1 relevant"
- "💡 Key insight: Self-evolving agents improve through feedback"
- "🧬 Strategy Evolved! v1 → v2: Low save rate (25%)"

---

## 🧬 The Agent Truly Evolves!

This is not just tracking - the agent **literally changes its behavior** based on what works:

1. **v1** tries deep research with many followups → Poor results
2. **System learns:** "Deep search isn't working, try focused approach"
3. **v2** uses shallow search with strict limits → Better results!
4. **Agent has evolved!** 🎉

---

## 🛠️ Toggle Between Modes

```bash
# Use workflow mode (evolution visible in UI)
USE_WORKFLOW=true npm run dev

# Use streaming mode (faster, evolution in background) - DEFAULT
npm run dev
```

Both modes work! Streaming mode is recommended for production.

---

## 📚 Documentation

- **Architecture**: `docs/SELF_EVOLVING_AGENT_IMPLEMENTATION.md`
- **Integration**: `docs/STRATEGY_INTEGRATION_GUIDE.md`
- **Testing**: `scripts/test-strategy-evolution.ts`
- **Streaming**: `docs/STREAMING_RESEARCH_IMPLEMENTATION.md`

---

## 🎯 Success Metrics

From the test run:
- ✅ Strategy v1 created automatically
- ✅ Episodes tracked with metrics
- ✅ Evolution triggered after 6 episodes
- ✅ Strategy v2 created as candidate (20%)
- ✅ Configuration changed appropriately:
  - `searchDepth`: standard → **shallow**
  - `timeWindow`: week → **month**
  - `sensoFirst`: false → **true**
  - `maxFollowups`: none → **3**

---

## 🚀 Ready to Use!

Your self-evolving agent system is **fully operational**. Just:
1. Start the app: `npm run dev`
2. Go to a topic
3. Ask research questions
4. Watch the agent evolve itself!

**The agent now learns from experience and improves its own strategy!** 🧠✨

---

*Built with: Mastra, Prisma, Next.js, React, Tailwind, AI SDK*

