export type StrategyConfigPayload = {
  version: number;
  status: "active" | "candidate" | "archived";
  rolloutPercentage: number;
  tools: string[]; // e.g. ["Airia", "Senso", "Raindrop"]
  sensoFirst: boolean;
  summaryTemplates: ("bullets" | "comparison" | "narrative" | "prd")[];
  timeWindow: "day" | "week" | "month" | "all";
  searchDepth: "shallow" | "deep";
  fitness?: number;
  metrics?: {
    episodes: number;
    saveRate: number; // 0–1
    sensoReuseRate: number; // 0–1
    followupPenalty: number;
  };
};

export type Note = {
  id: string;
  topicId: string;
  title: string;
  content: string; // markdown-ish text
  type: "research" | "update";
  createdAt: string;
};

export type Topic = {
  id: string;
  title: string;
  description?: string;
  watchEnabled: boolean;
  activeStrategyVersion: number;
  strategies: StrategyConfigPayload[];
  notes: Note[];
  evolutionLogs: {
    id: string;
    fromVersion?: number;
    toVersion: number;
    createdAt: string;
    summary: string; // human-readable explanation of what changed
  }[];
};

// Mock data
export const mockTopics: Topic[] = [
  {
    id: "1",
    title: "Self-Evolving Agents",
    description: "Research on autonomous agents that improve their own strategies",
    watchEnabled: true,
    activeStrategyVersion: 1,
    strategies: [
      {
        version: 0,
        status: "archived",
        rolloutPercentage: 0,
        tools: ["Airia", "Raindrop"],
        sensoFirst: false,
        summaryTemplates: ["bullets"],
        timeWindow: "week",
        searchDepth: "shallow",
        fitness: 0.62,
        metrics: {
          episodes: 45,
          saveRate: 0.58,
          sensoReuseRate: 0.22,
          followupPenalty: 0.18,
        },
      },
      {
        version: 1,
        status: "active",
        rolloutPercentage: 80,
        tools: ["Airia", "Senso", "Raindrop"],
        sensoFirst: true,
        summaryTemplates: ["bullets", "comparison"],
        timeWindow: "week",
        searchDepth: "deep",
        fitness: 0.78,
        metrics: {
          episodes: 127,
          saveRate: 0.65,
          sensoReuseRate: 0.40,
          followupPenalty: 0.12,
        },
      },
      {
        version: 2,
        status: "candidate",
        rolloutPercentage: 20,
        tools: ["Airia", "Senso", "Raindrop", "GitHub"],
        sensoFirst: true,
        summaryTemplates: ["bullets", "comparison", "narrative"],
        timeWindow: "month",
        searchDepth: "deep",
        fitness: 0.82,
        metrics: {
          episodes: 34,
          saveRate: 0.71,
          sensoReuseRate: 0.45,
          followupPenalty: 0.09,
        },
      },
    ],
    notes: [
      {
        id: "n1",
        topicId: "1",
        title: "Initial Research: Agent Architecture Patterns",
        content: `# Agent Architecture Patterns

Recent developments in agent architectures show three main patterns:

## 1. Reactive Agents
- Simple stimulus-response patterns
- Fast execution but limited adaptability
- Best for well-defined tasks

## 2. Deliberative Agents
- Internal world models
- Planning and reasoning capabilities
- Higher latency but better for complex tasks

## 3. Hybrid Approaches
- Combine reactive and deliberative elements
- Balance speed and sophistication
- Most promising for real-world applications

Key insight: Self-evolving agents benefit most from hybrid architectures that can adapt their reactive/deliberative balance based on task complexity.`,
        type: "research",
        createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: "n2",
        topicId: "1",
        title: "Strategy Update: Added Senso-first approach",
        content: `Strategy v1 deployed with significant improvements:

- Enabled Senso-first mode for faster semantic lookups
- Added comparison summaries to help users understand trade-offs
- Increased search depth from shallow to deep
- Initial metrics show 12% improvement in save rate

The agent now checks Senso cache before querying external sources, reducing latency by ~40% on cache hits.`,
        type: "update",
        createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: "n3",
        topicId: "1",
        title: "Research: Meta-learning approaches in autonomous systems",
        content: `# Meta-learning for Strategy Evolution

Investigating how agents can learn to learn:

**Key Findings:**
- Model-Agnostic Meta-Learning (MAML) shows promise for few-shot adaptation
- Evolutionary strategies can optimize hyperparameters automatically
- Combining RL with evolutionary approaches yields best results

**Relevant Papers:**
- "Learning to Learn" (Thrun, 1998)
- "Meta-Learning with Differentiable Convex Optimization" (Lee et al., 2019)
- "Evolving Neural Networks through Augmenting Topologies" (Stanley & Miikkulainen, 2002)

**Next Steps:**
- Implement fitness function based on save rate and reuse metrics
- Test mutation strategies for tool selection
- Evaluate cross-validation approaches for strategy comparison`,
        type: "research",
        createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: "n4",
        topicId: "1",
        title: "Comparative Analysis: Tool Effectiveness",
        content: `Analyzed tool usage patterns across 127 episodes:

| Tool | Usage % | Save Rate | Avg Latency |
|------|---------|-----------|-------------|
| Airia | 95% | 68% | 2.3s |
| Senso | 78% | 72% | 0.8s |
| Raindrop | 45% | 61% | 1.9s |
| GitHub | 12% | 82% | 3.1s |

**Insights:**
- Senso has highest save rate and lowest latency
- GitHub rarely used but high value when relevant
- Raindrop underutilized despite decent performance

**Recommendations:**
- Increase GitHub weighting for code-related queries
- Implement smarter Raindrop triggering logic
- Consider Senso-first as default strategy`,
        type: "research",
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: "n5",
        topicId: "1",
        title: "Evolution Log: Strategy v2 Candidate Created",
        content: `New candidate strategy (v2) created based on recent learnings:

**Changes from v1:**
- Added GitHub tool integration
- Expanded time window from week to month
- Added narrative summary template
- Improved fitness score: 0.78 → 0.82

**Reasoning:**
Analysis of 127 episodes showed that code-related queries had highest user engagement but were underserved. Adding GitHub tool and longer time window should capture more relevant technical content.

**Rollout Plan:**
- Currently at 20% traffic
- Will monitor for 2 weeks
- Promote to active if save rate exceeds 70%`,
        type: "update",
        createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      },
    ],
    evolutionLogs: [
      {
        id: "e1",
        fromVersion: 0,
        toVersion: 1,
        createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        summary:
          "Increased search depth from shallow to deep, enabled Senso-first mode, added comparison summaries. Fitness improved from 0.62 to 0.78.",
      },
      {
        id: "e2",
        toVersion: 2,
        fromVersion: 1,
        createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        summary:
          "Added GitHub tool integration, expanded time window to month, added narrative summaries. Early results show 0.82 fitness score.",
      },
    ],
  },
];

export const getTopicById = (id: string): Topic | undefined => {
  return mockTopics.find((t) => t.id === id);
};

export const getStrategyByVersion = (
  topic: Topic,
  version: number
): StrategyConfigPayload | undefined => {
  return topic.strategies.find((s) => s.version === version);
};

export const getActiveStrategy = (topic: Topic): StrategyConfigPayload | undefined => {
  return getStrategyByVersion(topic, topic.activeStrategyVersion);
};

