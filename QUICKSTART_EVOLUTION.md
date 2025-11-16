# 🚀 Quick Start - Self-Evolving Agent

## Test It Right Now!

### 1. Start the App
```bash
npm run dev
```

### 2. Open Browser
```
http://localhost:3000/topics
```

### 3. Create or Open a Topic
Click on "Self-evolving AI agents" (or any topic)

### 4. Ask a Research Question
```
What are the applications of self-evolving agents in AI?
```

### 5. Watch Real-Time Magic ✨

**You'll see:**
- 🧠 "Using strategy v1 (standard search)"
- 🔍 Blue cards showing searches & URLs
- ⚖️ Yellow cards showing evaluation results  
- 💡 Purple cards showing extracted insights
- 📝 Beautifully formatted research report

**Right panel shows:**
- 🟣 LIVE badge (pulsing)
- Current execution status
- Tool call history
- Live metrics updating

### 6. Trigger Evolution (Test)

Run this script to simulate poor performance:
```bash
npx tsx scripts/test-strategy-evolution.ts
```

This creates 6 episodes with 25% save rate → **Triggers automatic evolution!**

### 7. See The Evolution

Check console logs:
```
Episode analysis: { recommendation: 'evolve', reason: 'Low save rate (25%)' }
Evolving strategy for topic X: Low avg save rate (25%) across 6 episodes
Created new strategy v2
```

Check database:
```bash
npx prisma studio
# Navigate to StrategyConfig table
# See v1 (active, 100%) and v2 (candidate, 20%)
```

### 8. Use Evolved Strategy

Ask another question - it will automatically use the evolved strategy!

---

## Toggle Workflow Mode

Want to see evolution in real-time during research?

```bash
USE_WORKFLOW=true npm run dev
```

Now when evolution happens, you'll see:
- "📊 Analyzing performance..."
- "🧬 Evolving strategy..."
- "🧬 Strategy Evolved! v1 → v2: Low save rate"

All streamed in real-time! 🎉

---

## What The Agent Learned

### v1 → v2 Evolution Example:

**Before (v1):**
```json
{
  "searchDepth": "standard",
  "timeWindow": "week",
  "sensoFirst": false
}
```

**After (v2 - Auto-evolved!):**
```json
{
  "searchDepth": "shallow",      // ← Focused instead of broad
  "timeWindow": "month",          // ← Expanded time scope
  "sensoFirst": true,             // ← Try knowledge base first
  "maxFollowups": 3               // ← Limit queries
}
```

**Why?** Poor save rate (25%) meant the broad approach wasn't finding quality sources. Agent learned to be more focused!

---

## Key Features Working

✅ Strategy-driven execution  
✅ Runtime context passing  
✅ Tool adaptation (search depth, result count, evaluation criteria)  
✅ Performance tracking  
✅ Automatic analysis  
✅ Evolution logic  
✅ Database persistence  
✅ Real-time UI updates  
✅ Workflow integration  
✅ Evolution notifications  
✅ Markdown rendering  
✅ Live agent brain dashboard  

---

## Files Created

All the infrastructure is in place:
- Evolution logic: `src/lib/strategyEvolution.ts`
- Workflow: `src/mastra/workflows/selfEvolvingResearchWorkflow.ts`
- Strategy-aware tools: All 3 research tools updated
- UI components: LiveAgentBrainPanel, StrategyEvolutionAlert, StreamingNoteCard
- APIs: Evolution endpoints, streaming with dual mode
- Tests: Complete test script

---

**The agent is now self-aware and self-improving!** 🧠✨

Just use it normally - evolution happens automatically in the background!

