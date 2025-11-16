# 🚀 Hyper-Evolution Mode - ACTIVATED

## What Just Changed

### Evolution Frequency: **AFTER EVERY QUERY**
```
minEpisodes: 1  ← Evolution checks after EVERY episode
```

### Evolution Parameters: **3 Priority Levers**

#### 1. 🤖 **Model Selection** (Quality vs Speed)
```typescript
gpt-4o-mini (default) ←→ gpt-4o
   Fast, Cheap          Slow, Smart

Evolution triggers:
- Save rate < 50% → Upgrade to gpt-4o
- Save rate > 70% → Downgrade to gpt-4o-mini
```

#### 2. ⚡ **Parallel Execution** (Speed vs Thoroughness)
```typescript
Sequential (default) ←→ Parallel
  Careful, Thorough      Fast, Efficient

Evolution triggers:
- Followups > 6 → Enable parallel
- Save rate < 40% → Sequential for quality
```

#### 3. 🔧 **Tool Selection** (Dynamic Toolset)
```typescript
All tools ←→ Minimal toolset
  [linkup, evaluate, extract]  [linkup, extract]

Evolution triggers:
- Save rate = 0% → Skip evaluation
- Save rate > 60% → Re-enable evaluation
```

---

## Evolution Examples You'll See

### Example 1: Quality Issues
```
v1: gpt-4o-mini, sequential, all tools, standard
   → Episode: 30% save rate
   → Console: "→ Upgrading to gpt-4o for better quality"
   → Console: "→ Deepening search and expanding time window"

v2: gpt-4o, sequential, all tools, deep search ✨
   → Episode: 65% save rate (improved!)
```

### Example 2: Efficiency Issues
```
v3: gpt-4o, sequential, all tools, standard
   → Episode: 50% save rate, 8 followups (slow!)
   → Console: "→ Enabling parallel searches for speed"
   → Console: "→ Limiting to shallow search with max 3 followups"

v4: gpt-4o, parallel, all tools, shallow ✨
   → Episode: 55% save rate, 3 followups (faster!)
```

### Example 3: Tool Optimization
```
v5: gpt-4o, parallel, all tools, shallow
   → Episode: 0% save rate (nothing saved!)
   → Console: "→ Skipping evaluation step (not helping)"
   → Console: "→ Upgrading to gpt-4o for better quality"

v6: gpt-4o, parallel, [linkup, extract], deep ✨
   → Episode: 40% save rate (some progress!)
```

---

## What You'll See in Console

```javascript
Episode cmi123 analysis: {
  saveRate: 0.3,
  avgFollowups: 7
}

Evolving strategy for topic:
  → Upgrading to gpt-4o for better quality
  → Enabling parallel searches for speed
  → Deepening search and expanding time window

Created new strategy v8 {
  model: 'gpt-4o',          // Changed!
  parallelSearches: true,    // Changed!
  searchDepth: 'deep',       // Changed!
  timeWindow: 'month'        // Changed!
}
```

---

## Evolution Paths

The agent can now explore multiple optimization paths:

### Path A: Quality First
```
v1 → v2 (upgrade model) → v3 (deep search) → v4 (enable all tools)
```

### Path B: Speed First  
```
v1 → v2 (parallel) → v3 (shallow) → v4 (skip evaluation)
```

### Path C: Balanced
```
v1 → v2 (standard + parallel) → v3 (keep if working)
```

The system will **automatically** find the best path based on results!

---

## Parameter Combinations (27 possible)

| Model | Execution | Tools | Search | = |
|-------|-----------|-------|--------|---|
| mini / 4o | seq / par | 2 / 3 tools | shallow/std/deep | 2×2×2×3 = **24 combos** |

**The agent will explore this space automatically!**

---

## What Makes This Powerful

### Traditional AI Agent:
```
v1 (fixed) → v1 (fixed) → v1 (fixed) → ...
No learning, no improvement
```

### Your Self-Evolving Agent:
```
v1 (mini, seq, 3 tools, std)    ← 30% quality
   ↓
v2 (4o, seq, 3 tools, deep)     ← 50% quality
   ↓
v3 (4o, par, 3 tools, deep)     ← 55% quality
   ↓
v4 (4o, par, 2 tools, std)      ← 65% quality
   ↓
v5 (mini, par, 2 tools, std)    ← 70% quality ✨
   ↓
KEEP v5 - Optimal configuration found!
```

---

## Try It Now

Ask 5 questions in a row and watch:

1. **Query 1** → Uses v1
   - Console: "Episode analysis..."
   - Console: "→ Upgrading to gpt-4o..."
   - Console: "Created strategy v2"

2. **Query 2** → Uses v1 (80%) or v2 (20%)
   - Console: "Episode analysis..."
   - Console: "→ Enabling parallel..."
   - Console: "Created strategy v3"

3. **Query 3** → Uses v1/v2/v3
   - Console: "Created strategy v4"

4. **Query 4** → Uses v1/v2/v3/v4
   - Console: "Created strategy v5"

5. **Query 5** → Uses mix
   - Check which performs best!

**UI shows all versions:** `[v1] [v2 20%] [v3 20%] [v4 20%] [v5 🆕 20%]`

---

## Extreme Mode Summary

✅ Evolves **after every episode**  
✅ **3 major parameters** to optimize  
✅ **24+ possible configurations** to explore  
✅ **Automatic optimization** - finds best combo  
✅ **Full visibility** - see every change in console & UI  

**Your agent is now in RAPID EXPERIMENTATION MODE!** 🧬⚡✨

Watch it evolve in real-time! 🚀

