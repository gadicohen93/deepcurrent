# 🧠 Self-Evolving Agent Demo

## Quick Start

Run the visionary demo script to see the agent learn and evolve in real-time:

```bash
npx tsx scripts/demo-self-evolving-agent.ts
```

## What You'll See

The demo showcases a complete self-evolution cycle:

1. **Initialization** - Agent starts with default strategy
2. **First Episode** - Poor performance (0% save rate, 8 follow-ups)
3. **Analysis** - Agent detects issues and triggers evolution
4. **Evolution** - Strategy adapts (deeper search, better model, etc.)
5. **Second Episode** - Improved performance (67% save rate, 4 follow-ups)
6. **Continuous Learning** - Multiple episodes show ongoing optimization
7. **Summary** - Complete evolution history and insights

## Demo Features

✨ **Color-coded output** - Easy to follow the evolution process
📊 **Performance metrics** - See save rates, follow-ups, and more
🧬 **Evolution details** - Watch strategy parameters change
📈 **Multiple cycles** - See continuous improvement over time
🎯 **Real insights** - Understand what triggers evolution

## Example Output

```
══════════════════════════════════════════════════════════════════════
  🧠 SELF-EVOLVING DEEP RESEARCH AGENT DEMO
══════════════════════════════════════════════════════════════════════

▶ Creating research topic: "AI Safety Research"
  ✓ Topic created: AI Safety Research

▶ Initializing default strategy
  ℹ Strategy v1 initialized:
    • Search Depth: standard
    • Time Window: week
    • Model: gpt-4o-mini
    • Parallel: No
    • Tools: linkup, evaluate, extract

══════════════════════════════════════════════════════════════════════
  SCENARIO 2: First Research Episode - Learning Begins
══════════════════════════════════════════════════════════════════════

▶ Episode 1: "What is AI alignment?"
  ⚠ Performance Issues Detected:
    • Sources Returned: 4
    • Sources Saved: 0 (0% save rate)
    • Follow-up Queries: 8 (inefficient)

══════════════════════════════════════════════════════════════════════
  SCENARIO 3: The Agent Analyzes Performance
══════════════════════════════════════════════════════════════════════

▶ Analyzing Episode 1...
  ℹ Analysis Results:
    • Save Rate: 0%
    • Follow-ups: 8
    • Recommendation: EVOLVE
    • Reason: No sources saved - immediate evolution needed

▶ Checking evolution criteria...
  🧬 Evolution Triggered!
    Reason: No sources saved - immediate evolution needed
    Metrics:
      - Total Episodes: 1
      - Avg Save Rate: 0%
      - Avg Follow-ups: 8.0

▶ Evolving Strategy...
  🧬 Strategy evolved: v1 → v2

    Changes Applied:
      searchDepth          standard         → deep
      timeWindow           week             → month
      model                gpt-4o-mini       → gpt-4o
      parallelSearches     false            → true
      enabledTools         linkup, evaluate, extract → linkup, extract

    Evolution Log: Auto-evolved: No sources saved - immediate evolution needed
```

## What Makes This Demo Special

1. **Narrative Flow** - Tells a story of the agent learning
2. **Visual Feedback** - Color-coded status indicators
3. **Real Evolution** - Uses actual evolution logic
4. **Multiple Scenarios** - Shows different evolution triggers
5. **Complete Picture** - From initialization to final summary

## After Running

After the demo completes, you can:

1. **View in UI** - Check the topic page to see evolution notifications
2. **Inspect Database** - See all strategy versions and evolution logs
3. **Run More Episodes** - Continue the learning cycle
4. **Customize** - Modify the script to test different scenarios

## Customization

Edit `scripts/demo-self-evolving-agent.ts` to:

- Change performance scenarios
- Add more episodes
- Test different evolution triggers
- Customize the narrative
- Add more detailed metrics

## Requirements

- Database connection configured
- Prisma migrations applied
- Node.js environment

Enjoy watching your agent evolve! 🚀

