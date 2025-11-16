# Enhanced Strategy Evolution UI

## Overview
The Strategy Evolved notification now displays comprehensive details about what changed and why, making the self-evolution process transparent and informative.

## Enhanced Display

### Before
```
Strategy Evolved!
v2 → v3
Auto-evolved: No sources saved - immediate evolution needed
The agent automatically improved its strategy based on performance data.
```

### After
```
Strategy Evolved!
v2 → v3

Auto-evolved: No sources saved - immediate evolution needed

📊 Performance Metrics:
  Save Rate: 0%
  Follow-ups: 6.5
  Episodes: 1

🔧 Changes:
  Search Depth: standard → deep
  Time Window: week → month
  Model: gpt-4o-mini → gpt-4o
  Parallel Searches: ✗ → ✓
  Enabled Tools: linkup, evaluate, extract → linkup, extract

💡 The agent self-optimized based on real performance data
```

## What's Displayed

### 1. **Version Transition**
- Shows clear version progression (v2 → v3)
- Helps track evolution lineage

### 2. **Evolution Reason**
- Natural language explanation of why evolution was triggered
- Examples:
  - "No sources saved - immediate evolution needed"
  - "Low save rate (45%) - evolving for improvement"
  - "High follow-ups (6.2) - optimizing efficiency"

### 3. **Performance Metrics** (📊)
Displays the actual metrics that triggered the evolution:
- **Save Rate**: Percentage of sources saved vs returned
- **Follow-ups**: Average number of follow-up queries per episode
- **Episodes**: Number of episodes analyzed

### 4. **Parameter Changes** (🔧)
Shows exactly what changed in the strategy config:
- **Before value** (shown in gray with strikethrough)
- **Arrow** (→)
- **After value** (shown in green)

Common parameters that evolve:
- `searchDepth`: shallow | standard | deep
- `timeWindow`: day | week | month | all
- `model`: gpt-4o-mini | gpt-4o
- `parallelSearches`: true | false (✓ | ✗)
- `enabledTools`: Array of enabled tool names
- `maxFollowups`: Numeric limit
- `skipEvaluation`: true | false

### 5. **Value Formatting**
- **Booleans**: ✓ (true) or ✗ (false)
- **Arrays**: Comma-separated list
- **Objects**: JSON string
- **Primitives**: String representation

### 6. **Visual Hierarchy**
```
🧬 [Icon]
├─ Strategy Evolved! [Purple badge]
├─ v2 → v3 [Gray text]
├─ Reason [White text]
├─ 📊 Performance Metrics [Dark background]
│  ├─ Save Rate: 0%
│  ├─ Follow-ups: 6.5
│  └─ Episodes: 1
├─ 🔧 Changes [List of changes]
│  ├─ Search Depth: standard → deep
│  ├─ Time Window: week → month
│  └─ ...
└─ 💡 Explanation [Purple text]
```

## Implementation Details

### Data Flow
1. **Evolution happens** → Backend creates `StrategyEvolutionLog` with `changesJson`
2. **API endpoint** → `/api/topics/[id]/evolutions` parses and returns JSON
3. **Frontend hook** → `useRecentEvolutions` polls every 5 seconds
4. **UI renders** → Parses changes and displays detailed breakdown

### Key Files
- `/hooks/useRecentEvolutions.ts` - Polling and state management
- `/app/topics/[id]/page.tsx` - Enhanced rendering logic
- `/src/lib/strategyEvolution.ts` - Evolution logic with changesJson
- `/app/api/topics/[id]/evolutions/route.ts` - API endpoint

## User Benefits

### 1. **Transparency**
Users can see exactly what the agent is learning and how it's adapting.

### 2. **Debugging**
If evolution goes wrong, the detailed changes make it easy to identify the issue.

### 3. **Learning**
Users can observe patterns in what triggers evolution and what changes are effective.

### 4. **Trust**
Seeing the metrics and reasoning builds confidence in the self-evolving system.

## Future Enhancements

### Potential additions:
1. **Impact prediction**: Show expected improvement from changes
2. **Rollback button**: Allow manual reversion to previous strategy
3. **Comparison view**: Side-by-side before/after config
4. **Evolution graph**: Visualize strategy lineage over time
5. **A/B test status**: Show rollout percentage for candidate strategies
6. **Performance delta**: Show actual improvement in next episode

## Example Evolution Scenarios

### Scenario 1: No Sources
```
Metrics: { saveRate: 0%, followups: 3, episodes: 1 }
Changes:
  - skipEvaluation: ✗ → ✓
  - enabledTools: [linkup, evaluate, extract] → [linkup, extract]
Reason: "No sources saved - skipping evaluation to save time"
```

### Scenario 2: Too Many Follow-ups
```
Metrics: { saveRate: 65%, followups: 8.2, episodes: 3 }
Changes:
  - searchDepth: deep → shallow
  - maxFollowups: undefined → 3
  - parallelSearches: ✗ → ✓
Reason: "High follow-ups (8.2) - optimizing efficiency"
```

### Scenario 3: Low Quality
```
Metrics: { saveRate: 35%, followups: 4, episodes: 2 }
Changes:
  - model: gpt-4o-mini → gpt-4o
  - searchDepth: standard → deep
  - timeWindow: week → month
Reason: "Low save rate (35%) - evolving for improvement"
```

## Conclusion

The enhanced Strategy Evolved UI transforms a simple notification into a comprehensive view of the agent's learning process, making the self-evolution system both transparent and actionable.

