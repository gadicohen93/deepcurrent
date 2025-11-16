import { MemoryProcessor, Mastra } from '@mastra/core';
import { LibSQLVector, LibSQLStore } from '@mastra/libsql';
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { PinoLogger } from '@mastra/loggers';
import { getActiveStrategy } from '@/repositories/strategies';
import { analyzeEpisodePerformance, shouldEvolveStrategy, evolveStrategy } from '@/lib/strategyEvolution';
import { updateEpisodeStatus } from '@/repositories/episodes';
import { createNote } from '@/repositories/notes';
import { Agent } from '@mastra/core/agent';
import { google } from '@ai-sdk/google';
import { Memory } from '@mastra/memory';
import { ToneConsistencyMetric, KeywordCoverageMetric, TextualDifferenceMetric, CompletenessMetric, ContentSimilarityMetric } from '@mastra/evals/nlp';
import { openai } from '@ai-sdk/openai';
import { createTool } from '@mastra/core/tools';
import { LinkupClient } from 'linkup-sdk';

const logger$b = new PinoLogger({ level: "info" });
const getUserQueryStep = createStep({
  id: "get-user-query",
  inputSchema: z.object({}),
  outputSchema: z.object({
    query: z.string()
  }),
  resumeSchema: z.object({
    query: z.string()
  }),
  suspendSchema: z.object({
    message: z.object({
      query: z.string()
    })
  }),
  execute: async ({ resumeData, suspend }) => {
    if (resumeData) {
      return {
        ...resumeData,
        query: resumeData.query || ""
      };
    }
    await suspend({
      message: {
        query: "What would you like to research?"
      }
    });
    return {
      query: ""
    };
  }
});
const researchStep = createStep({
  id: "research",
  inputSchema: z.object({
    query: z.string()
  }),
  outputSchema: z.object({
    researchData: z.any(),
    summary: z.string()
  }),
  execute: async ({ inputData, mastra }) => {
    const { query } = inputData;
    try {
      const agent = mastra.getAgent("researchAgent");
      const researchPrompt = `Research the following topic thoroughly using the two-phase process: "${query}".

      Phase 1: Search for 2-3 initial queries about this topic
      Phase 2: Search for follow-up questions from the learnings (then STOP)

      Return findings in JSON format with queries, searchResults, learnings, completedQueries, and phase.`;
      const result = await agent.generateVNext(
        [
          {
            role: "user",
            content: researchPrompt
          }
        ],
        {
          maxSteps: 15,
          output: z.object({
            queries: z.array(z.string()),
            searchResults: z.array(
              z.object({
                title: z.string(),
                url: z.string(),
                relevance: z.string()
              })
            ),
            learnings: z.array(
              z.object({
                learning: z.string(),
                followUpQuestions: z.array(z.string()),
                source: z.string()
              })
            ),
            completedQueries: z.array(z.string()),
            phase: z.string().optional()
          })
        }
      );
      const summary = `Research completed on "${query}:" 

 ${JSON.stringify(result.object, null, 2)}

`;
      return {
        researchData: result.object,
        summary
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger$b.error("Error in researchStep", { error: err.message, stack: err.stack });
      return {
        researchData: { error: err.message },
        summary: `Error: ${err.message}`
      };
    }
  }
});
const approvalStep = createStep({
  id: "approval",
  inputSchema: z.object({
    researchData: z.any(),
    summary: z.string()
  }),
  outputSchema: z.object({
    approved: z.boolean(),
    researchData: z.any()
  }),
  resumeSchema: z.object({
    approved: z.boolean()
  }),
  execute: async ({ inputData, resumeData, suspend }) => {
    if (resumeData) {
      return {
        ...resumeData,
        researchData: inputData.researchData
      };
    }
    await suspend({
      summary: inputData.summary,
      message: `Is this research sufficient? [y/n] `
    });
    return {
      approved: false,
      researchData: inputData.researchData
    };
  }
});
const researchWorkflow = createWorkflow({
  id: "research-workflow",
  inputSchema: z.object({}),
  outputSchema: z.object({
    approved: z.boolean(),
    researchData: z.any()
  }),
  steps: [getUserQueryStep, researchStep, approvalStep]
});
researchWorkflow.then(getUserQueryStep).then(researchStep).then(approvalStep).commit();

const loadStrategyStep = createStep({
  id: "load-strategy",
  description: "Load active strategy configuration for the topic",
  inputSchema: z.object({
    topicId: z.string(),
    episodeId: z.string(),
    query: z.string()
  }),
  execute: async ({ context: { inputData } }) => {
    const strategy = await getActiveStrategy(inputData.topicId);
    if (!strategy) {
      return {
        ...inputData,
        strategyVersion: 1,
        config: {
          searchDepth: "standard",
          timeWindow: "week",
          summaryTemplates: ["bullets"],
          sensoFirst: false
        }
      };
    }
    const config = JSON.parse(strategy.configJson);
    return {
      ...inputData,
      strategyVersion: strategy.version,
      config
    };
  }
});
const executeResearchStep = createStep({
  id: "execute-research",
  description: "Execute research using the loaded strategy",
  inputSchema: z.object({
    topicId: z.string(),
    episodeId: z.string(),
    query: z.string(),
    strategyVersion: z.number(),
    config: z.any()
  }),
  execute: async ({ context: { inputData }, mastra }) => {
    await updateEpisodeStatus(inputData.episodeId, "running");
    const researchAgent = mastra.getAgent("researchAgent");
    const searchInstructions = inputData.config.searchDepth === "deep" ? "Conduct thorough, deep research with multiple follow-up queries (up to 5)." : inputData.config.searchDepth === "shallow" ? "Conduct quick, focused research with minimal follow-ups (1-2 max)." : "Conduct focused research with targeted follow-up queries (2-3).";
    const result = await researchAgent.generate(
      [
        {
          role: "user",
          content: `Research the following topic: "${inputData.query}"

**Research Strategy Configuration (v${inputData.strategyVersion}):**
- Search Depth: ${inputData.config.searchDepth}
- Time Window: ${inputData.config.timeWindow}
- ${searchInstructions}
${inputData.config.maxFollowups ? `- Maximum follow-up queries: ${inputData.config.maxFollowups}` : ""}

Provide a comprehensive summary with:
1. Key findings
2. Important insights
3. Relevant sources (with URLs)

Format your response in clear, readable markdown.`
        }
      ],
      {
        runtimeContext: {
          strategyVersion: inputData.strategyVersion,
          ...inputData.config,
          topicId: inputData.topicId,
          episodeId: inputData.episodeId
        }
      }
    );
    const note = await createNote({
      topicId: inputData.topicId,
      title: `Research: ${inputData.query.substring(0, 60)}${inputData.query.length > 60 ? "..." : ""}`,
      content: result.text,
      type: "research"
    });
    await updateEpisodeStatus(inputData.episodeId, "completed", {
      resultNoteId: note.id,
      sourcesReturned: [],
      sourcesSaved: []
    });
    return {
      ...inputData,
      result: result.text,
      noteId: note.id
    };
  }
});
const analyzePerformanceStep = createStep({
  id: "analyze-performance",
  description: "Analyze the episode performance and determine if evolution is needed",
  inputSchema: z.object({
    episodeId: z.string(),
    topicId: z.string(),
    strategyVersion: z.number()
  }),
  execute: async ({ context: { inputData } }) => {
    const analysis = await analyzeEpisodePerformance(inputData.episodeId);
    const evolution = await shouldEvolveStrategy(
      inputData.topicId,
      inputData.strategyVersion,
      5
      // Minimum episodes before evolution
    );
    return {
      analysis,
      shouldEvolve: evolution.shouldEvolve,
      evolutionReason: evolution.reason,
      metrics: evolution.metrics
    };
  }
});
const evolveStrategyStep = createStep({
  id: "evolve-strategy",
  description: "Create a new evolved strategy version",
  inputSchema: z.object({
    topicId: z.string(),
    strategyVersion: z.number(),
    evolutionReason: z.string(),
    metrics: z.any()
  }),
  execute: async ({ context: { inputData } }) => {
    const { newStrategy, evolutionLog } = await evolveStrategy(
      inputData.topicId,
      inputData.strategyVersion,
      {
        reason: inputData.evolutionReason,
        metrics: inputData.metrics
      }
    );
    return {
      newStrategyVersion: newStrategy.version,
      evolutionLogId: evolutionLog.id,
      reason: evolutionLog.reason
    };
  }
});
const selfEvolvingResearchWorkflow = createWorkflow({
  name: "self-evolving-research",
  triggerSchema: z.object({
    topicId: z.string(),
    episodeId: z.string(),
    query: z.string()
  })
}).then(loadStrategyStep).then(executeResearchStep).then(analyzePerformanceStep).branch([
  // If should evolve, create new strategy
  [
    async ({ event }) => {
      const analyzeResult = event.payload;
      return analyzeResult.shouldEvolve === true;
    },
    async ({ workflow }) => {
      return workflow.then(evolveStrategyStep).commit();
    }
  ]
]).commit();

const logger$a = new PinoLogger({ level: "info" });
const contentCache = /* @__PURE__ */ new WeakMap();
const lowercaseCache = /* @__PURE__ */ new WeakMap();
const similarityCache = /* @__PURE__ */ new Map();
const patternCache = /* @__PURE__ */ new Map();
function extractContent(msg) {
  if (contentCache.has(msg)) {
    return contentCache.get(msg);
  }
  let content;
  if (typeof msg.content === "string") {
    content = msg.content;
  } else if (Array.isArray(msg.content)) {
    content = msg.content.map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (part !== null && typeof part === "object" && "type" in part && part.type === "text") {
        return part.text ?? "";
      }
      if (part !== null && typeof part === "object" && "type" in part && part.type === "tool-result") {
        const p = part;
        return JSON.stringify(p.content ?? part);
      }
      return JSON.stringify(part);
    }).join(" ");
  } else {
    content = "";
  }
  contentCache.set(msg, content);
  return content;
}
function getLowercaseContent(msg) {
  if (lowercaseCache.has(msg)) {
    return lowercaseCache.get(msg);
  }
  const content = extractContent(msg).toLowerCase();
  lowercaseCache.set(msg, content);
  return content;
}
const CITATION_REGEX = /\[.*\]/i;
const WORD_BOUNDARY_REGEX = /\b\w{4,}\b/g;
const SENTENCE_END_REGEX = /[.!?]/g;
const URL_PATTERN = /https?:\/\/[^\s]+/gi;
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
const NUMBER_PATTERN = /\b\d+(\.\d+)?\b/g;
const DATE_PATTERN = /\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b|\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g;
const ACRONYM_PATTERN = /\b[A-Z]{2,}\b/g;
const QUOTES_PATTERN = /[""''""]|[''""'']/g;
const CODE_PATTERN = /```[\s\S]*?```|`[^`]+`/g;
const QUESTION_PATTERN = /\b(what|how|why|when|where|who|which|whose|whom)\b/gi;
const NAME_PATTERN = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g;
const TITLE_PATTERN = /\b(Dr|Prof|Mr|Mrs|Ms|PhD|MSc|BSc|CEO|CTO|CFO|VP|Director|Manager|Lead|Senior|Junior)\b/gi;
const PROFESSION_PATTERN = /\b(Engineer|Developer|Scientist|Researcher|Analyst|Consultant|Architect)\b/gi;
function estimateTokens(content) {
  if (!content) {
    return 0;
  }
  let tokens = 0;
  const len = content.length;
  for (let i = 0; i < len; i += 64) {
    const chunk = content.slice(i, i + 64);
    tokens += Math.ceil(chunk.length / 4);
  }
  return tokens;
}
function computeChecksum(content) {
  if (!content) {
    return "0";
  }
  let hash = 0;
  const len = content.length;
  if (len <= 16) {
    for (let i = 0; i < len; i++) {
      hash = (hash << 5) - hash + content.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(16);
  }
  for (let i = 0; i < len; i += 4) {
    const chunk = content.slice(i, i + 4);
    for (let j = 0; j < chunk.length; j++) {
      hash = (hash << 5) - hash + chunk.charCodeAt(j);
      hash |= 0;
    }
  }
  return Math.abs(hash).toString(16);
}
class TokenLimiterProcessor extends MemoryProcessor {
  maxTokens = 1e6;
  constructor({ options } = {}) {
    super({ name: "TokenLimiterProcessor" });
    if (options && typeof options.maxTokens === "number" && Number.isFinite(options.maxTokens) && options.maxTokens > 0) {
      this.maxTokens = options.maxTokens;
    }
  }
  process(messages, _opts) {
    if (!Array.isArray(messages)) {
      return messages;
    }
    if (messages.length === 0) {
      return messages;
    }
    let totalTokens = 0;
    const result = [];
    for (const msg of messages) {
      if (msg.role === "tool" || msg.role === "system") {
        result.push(msg);
        continue;
      }
      const content = extractContent(msg);
      const tokens = estimateTokens(content);
      if (totalTokens + tokens <= this.maxTokens) {
        result.push(msg);
        totalTokens += tokens;
      } else {
        logger$a.info("Token limit reached, stopping retrieval");
        break;
      }
    }
    return result;
  }
}
class ErrorCorrectionProcessor extends MemoryProcessor {
  process(messages, _opts) {
    if (!Array.isArray(messages)) {
      return messages;
    }
    const seen = /* @__PURE__ */ new Map();
    const result = [];
    for (const msg of messages) {
      const content = extractContent(msg);
      const checksum = computeChecksum(content);
      if (!seen.has(checksum)) {
        seen.set(checksum, true);
        result.push(msg);
      } else {
        logger$a.warn("Duplicate research content skipped");
      }
    }
    return result;
  }
}
class HierarchicalMemoryProcessor extends MemoryProcessor {
  threshold = 0.7;
  constructor(options) {
    super({ name: "HierarchicalMemoryProcessor" });
    if (typeof options?.threshold === "number") {
      this.threshold = options.threshold;
    }
  }
  process(messages, _opts) {
    if (!Array.isArray(messages)) {
      return messages;
    }
    return messages.filter((msg) => {
      if (msg.role === "tool" || msg.role === "system") {
        return true;
      }
      const content = extractContent(msg);
      const { length } = content;
      const cacheKey = `${content.slice(0, 50)}-${length}`;
      if (similarityCache.has(cacheKey)) {
        const cachedRelevance = similarityCache.get(cacheKey);
        if (cachedRelevance >= this.threshold) {
          logger$a.debug(`Retained cached semantic message (relevance: ${cachedRelevance})`);
          return true;
        } else {
          logger$a.debug(`Filtered cached episodic message (relevance: ${cachedRelevance})`);
          return false;
        }
      }
      const relevance = Math.min(1, length / 1e3);
      similarityCache.set(cacheKey, relevance);
      if (relevance >= this.threshold) {
        logger$a.debug(`Retained semantic message (relevance: ${relevance})`);
        return true;
      } else {
        logger$a.debug(`Filtered episodic message (relevance: ${relevance})`);
        return false;
      }
    });
  }
}
class PersonalizationProcessor extends MemoryProcessor {
  preferences = ["research", "AI", "analysis", "data"];
  // Default research terms
  constructor(options) {
    super({ name: "PersonalizationProcessor" });
    if (options?.preferences) {
      this.preferences = options.preferences;
    }
  }
  process(messages, _opts) {
    if (!Array.isArray(messages)) {
      return messages;
    }
    if (messages.length === 0) {
      return messages;
    }
    const result = [];
    for (const msg of messages) {
      if (msg.role === "tool" || msg.role === "system") {
        result.push(msg);
        continue;
      }
      const content = getLowercaseContent(msg);
      const rawContent = extractContent(msg);
      const relevant = this.preferences.some((pref) => content.includes(pref.toLowerCase())) || EMAIL_PATTERN.test(rawContent) || // Include contact info
      NAME_PATTERN.test(rawContent) || // Detect proper names
      TITLE_PATTERN.test(rawContent) || // Detect titles/professional designations
      PROFESSION_PATTERN.test(rawContent);
      if (relevant) {
        logger$a.debug("Retained personalized research message");
        result.push(msg);
      } else {
        logger$a.debug("Filtered non-personalized message");
      }
    }
    return result;
  }
}
class CitationExtractorProcessor extends MemoryProcessor {
  process(messages, _opts) {
    if (!Array.isArray(messages)) {
      return messages;
    }
    if (messages.length === 0) {
      return messages;
    }
    const result = [];
    for (const msg of messages) {
      if (msg.role === "tool" || msg.role === "system") {
        result.push(msg);
        continue;
      }
      const content = extractContent(msg);
      const hasCitation = CITATION_REGEX.test(content) || content.includes("source") || content.includes("ref") || WORD_BOUNDARY_REGEX.test(content) || // Academic words
      URL_PATTERN.test(content) || // Web sources
      QUOTES_PATTERN.test(content);
      if (hasCitation) {
        logger$a.debug("Retained message with citation");
        result.push(msg);
      } else {
        logger$a.debug("Filtered message without citation");
      }
    }
    return result;
  }
}
class MultiPerspectiveProcessor extends MemoryProcessor {
  viewpoints = ["technical", "ethical", "practical"];
  // Research perspectives
  constructor(options) {
    super({ name: "MultiPerspectiveProcessor" });
    if (options?.viewpoints) {
      this.viewpoints = options.viewpoints;
    }
  }
  process(messages, _opts) {
    if (!Array.isArray(messages)) {
      return messages;
    }
    if (messages.length === 0) {
      return messages;
    }
    const result = [];
    for (const msg of messages) {
      if (msg.role === "tool" || msg.role === "system") {
        result.push(msg);
        continue;
      }
      const content = getLowercaseContent(msg);
      const rawContent = extractContent(msg);
      const cacheKey = `${rawContent.slice(0, 50)}-${this.viewpoints.join(",")}`;
      if (patternCache.has(cacheKey)) {
        const cached = patternCache.get(cacheKey);
        if (cached) {
          logger$a.debug("Retained cached multi-perspective research message");
          result.push(msg);
        } else {
          logger$a.debug("Filtered cached single-perspective message");
        }
        continue;
      }
      const multiPerspective = this.viewpoints.some((view) => content.includes(view)) || CODE_PATTERN.test(rawContent);
      patternCache.set(cacheKey, multiPerspective);
      if (multiPerspective) {
        logger$a.debug("Retained multi-perspective research message");
        result.push(msg);
      } else {
        logger$a.debug("Filtered single-perspective message");
      }
    }
    return result;
  }
}
class TemporalReasoningProcessor extends MemoryProcessor {
  timeWindowHours = 24;
  // Default 24 hours
  constructor(options) {
    super({ name: "TemporalReasoningProcessor" });
    if (options?.timeWindowHours) {
      this.timeWindowHours = options.timeWindowHours;
    }
  }
  process(messages, _opts) {
    if (!Array.isArray(messages)) {
      return messages;
    }
    if (messages.length === 0) {
      return messages;
    }
    const result = [];
    const temporalIndicators = ["recently", "previously", "before", "after", "timeline", "chronological"];
    for (const msg of messages) {
      if (msg.role === "tool" || msg.role === "system") {
        result.push(msg);
        continue;
      }
      const content = getLowercaseContent(msg);
      const rawContent = extractContent(msg);
      const hasTemporalContext = temporalIndicators.some((indicator) => content.includes(indicator)) || DATE_PATTERN.test(rawContent);
      if (hasTemporalContext) {
        logger$a.debug("Retained temporal reasoning research message");
        result.push(msg);
      } else {
        logger$a.debug("Filtered non-temporal message");
      }
    }
    return result;
  }
}
class UncertaintyQuantificationProcessor extends MemoryProcessor {
  minConfidenceThreshold = 0.6;
  constructor(options) {
    super({ name: "UncertaintyQuantificationProcessor" });
    if (options?.minConfidenceThreshold) {
      this.minConfidenceThreshold = options.minConfidenceThreshold;
    }
  }
  process(messages, _opts) {
    if (!Array.isArray(messages)) {
      return messages;
    }
    if (messages.length === 0) {
      return messages;
    }
    const result = [];
    const uncertaintyIndicators = ["uncertain", "confidence", "probability", "likely", "evidence", "hypothesis"];
    for (const msg of messages) {
      if (msg.role === "tool" || msg.role === "system") {
        result.push(msg);
        continue;
      }
      const content = getLowercaseContent(msg);
      const rawContent = extractContent(msg);
      const hasUncertaintyQuantification = uncertaintyIndicators.some((indicator) => content.includes(indicator)) || SENTENCE_END_REGEX.test(rawContent) || // Sentence structure
      NUMBER_PATTERN.test(rawContent) || // Quantitative data
      QUESTION_PATTERN.test(rawContent);
      if (hasUncertaintyQuantification) {
        logger$a.debug("Retained uncertainty quantification research message");
        result.push(msg);
      } else {
        logger$a.debug("Filtered message without uncertainty quantification");
      }
    }
    return result;
  }
}
class KnowledgeGraphProcessor extends MemoryProcessor {
  graphTerms = ["relationship", "connection", "network", "graph", "entity", "link"];
  constructor(options) {
    super({ name: "KnowledgeGraphProcessor" });
    if (options?.graphTerms) {
      this.graphTerms = options.graphTerms;
    }
  }
  process(messages, _opts) {
    if (!Array.isArray(messages)) {
      return messages;
    }
    if (messages.length === 0) {
      return messages;
    }
    const result = [];
    for (const msg of messages) {
      if (msg.role === "tool" || msg.role === "system") {
        result.push(msg);
        continue;
      }
      const content = getLowercaseContent(msg);
      const rawContent = extractContent(msg);
      const hasGraphElements = this.graphTerms.some((term) => content.includes(term)) || ACRONYM_PATTERN.test(rawContent);
      if (hasGraphElements) {
        logger$a.debug("Retained knowledge graph research message");
        result.push(msg);
      } else {
        logger$a.debug("Filtered non-graph message");
      }
    }
    return result;
  }
}
class BayesianBeliefProcessor extends MemoryProcessor {
  beliefTerms = ["belief", "hypothesis", "evidence", "update", "probability", "bayesian"];
  constructor(options) {
    super({ name: "BayesianBeliefProcessor" });
    if (options?.beliefTerms) {
      this.beliefTerms = options.beliefTerms;
    }
  }
  process(messages, _opts) {
    if (!Array.isArray(messages)) {
      return messages;
    }
    if (messages.length === 0) {
      return messages;
    }
    const result = [];
    for (const msg of messages) {
      if (msg.role === "tool" || msg.role === "system") {
        result.push(msg);
        continue;
      }
      const content = getLowercaseContent(msg);
      const hasBayesianElements = this.beliefTerms.some((term) => content.includes(term));
      if (hasBayesianElements) {
        logger$a.debug("Retained Bayesian belief research message");
        result.push(msg);
      } else {
        logger$a.debug("Filtered non-Bayesian message");
      }
    }
    return result;
  }
}
class CircuitBreakerProcessor extends MemoryProcessor {
  failureThreshold = 3;
  recoveryTimeoutMs = 3e4;
  failureCount = 0;
  lastFailureTime = 0;
  isOpen = false;
  constructor(options) {
    super({ name: "CircuitBreakerProcessor" });
    if (options?.failureThreshold) {
      this.failureThreshold = options.failureThreshold;
    }
    if (options?.recoveryTimeoutMs) {
      this.recoveryTimeoutMs = options.recoveryTimeoutMs;
    }
  }
  process(messages, _opts) {
    if (!Array.isArray(messages)) {
      return messages;
    }
    if (this.isOpen) {
      const now = Date.now();
      if (now - this.lastFailureTime > this.recoveryTimeoutMs) {
        this.isOpen = false;
        this.failureCount = 0;
        logger$a.info("Circuit breaker attempting recovery");
      } else {
        logger$a.warn("Circuit breaker is open, skipping processing");
        return messages;
      }
    }
    try {
      const result = [];
      const reliabilityIndicators = ["reliable", "stable", "robust", "fault-tolerant", "recovery"];
      for (const msg of messages) {
        if (msg.role === "tool" || msg.role === "system") {
          result.push(msg);
          continue;
        }
        const content = getLowercaseContent(msg);
        const isReliable = reliabilityIndicators.some((indicator) => content.includes(indicator));
        if (isReliable) {
          logger$a.debug("Retained reliable research message");
          result.push(msg);
        } else {
          logger$a.debug("Filtered unreliable message");
        }
      }
      this.failureCount = 0;
      return result;
    } catch (error) {
      this.failureCount++;
      this.lastFailureTime = Date.now();
      if (this.failureCount >= this.failureThreshold) {
        this.isOpen = true;
        logger$a.error(`Circuit breaker opened after ${this.failureCount} failures`);
      }
      logger$a.error("Circuit breaker caught error in processing", {
        error: error instanceof Error ? error.message : "Unknown error",
        failureCount: this.failureCount
      });
      return messages;
    }
  }
}

const logger$9 = new PinoLogger({
  name: "libsql-storage",
  level: process.env.LOG_LEVEL ?? "info"
});
const STORAGE_CONFIG = {
  // Gemini embedding-001 dimension
  DEFAULT_DATABASE_URL: "file:./deep-research.db",
  VECTOR_DATABASE_URL: "file:./vector-store.db"};
const createLibSQLStore = (tracingContext) => {
  const startTime = Date.now();
  const databaseUrl = process.env.DATABASE_URL ?? STORAGE_CONFIG.DEFAULT_DATABASE_URL;
  try {
    const store = new LibSQLStore({
      url: databaseUrl,
      authToken: process.env.DATABASE_AUTH_TOKEN
    });
    const processingTime = Date.now() - startTime;
    logger$9.info("LibSQL storage initialized successfully", {
      databaseUrl: databaseUrl.replace(/authToken=[^&]*/, "authToken=***"),
      processingTime
    });
    return store;
  } catch (error) {
    const processingTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger$9.error("Failed to initialize LibSQL storage", {
      databaseUrl: databaseUrl.replace(/authToken=[^&]*/, "authToken=***"),
      error: errorMessage,
      processingTime
    });
    throw error;
  }
};
const createLibSQLVectorStore = (tracingContext) => {
  const startTime = Date.now();
  const databaseUrl = process.env.VECTOR_DATABASE_URL ?? STORAGE_CONFIG.VECTOR_DATABASE_URL;
  try {
    const vectorStore = new LibSQLVector({
      connectionUrl: databaseUrl,
      authToken: process.env.VECTOR_DATABASE_AUTH_TOKEN ?? process.env.DATABASE_AUTH_TOKEN
    });
    const processingTime = Date.now() - startTime;
    logger$9.info("LibSQL vector store initialized successfully", {
      databaseUrl: databaseUrl.replace(/authToken=[^&]*/, "authToken=***"),
      processingTime
    });
    return vectorStore;
  } catch (error) {
    const processingTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger$9.error("Failed to initialize LibSQL vector store", {
      databaseUrl: databaseUrl.replace(/authToken=[^&]*/, "authToken=***"),
      error: errorMessage,
      processingTime
    });
    throw error;
  }
};
const createResearchMemory = () => {
  return new Memory({
    storage: createLibSQLStore(),
    vector: createLibSQLVectorStore(),
    // TODO: Pass tracingContext
    embedder: google.textEmbedding("gemini-embedding-001"),
    options: {
      lastMessages: 500,
      workingMemory: {
        enabled: true,
        template: `# Agent Memory Context
- **User Task**: Research summary, analysis, recommendations, etc.
- **Target Audience**: Who will read this report
- **Key Findings**: Important discoveries from research
- **User Goals**: User long term goals
- **Process**: How to achieve goals, & actions nessary
- **Client Requirements**: Specific requirements or constraints


Always Respond to user as well as update this!  Its critical, to not get stuck just updating your working memory.
`
      },
      semanticRecall: {
        topK: 5,
        messageRange: 3,
        scope: "resource"
      },
      threads: {
        generateTitle: true
        // Enable automatic title generation
      }
    },
    processors: [
      new PersonalizationProcessor({ preferences: ["any"] }),
      new TokenLimiterProcessor({ options: { maxTokens: 1e6 } }),
      new CircuitBreakerProcessor({ failureThreshold: 0.5 }),
      new CitationExtractorProcessor({ component: logger$9, name: "citation-extractor" }),
      new ErrorCorrectionProcessor({ component: logger$9, name: "error-correction" }),
      new KnowledgeGraphProcessor(),
      new UncertaintyQuantificationProcessor(),
      new TemporalReasoningProcessor({ timeWindowHours: 24 }),
      new BayesianBeliefProcessor(),
      new HierarchicalMemoryProcessor({ threshold: 0.7 }),
      new MultiPerspectiveProcessor({ viewpoints: ["researcher", "analyst", "programmer", "designer", "developer", "manager", "product_owner", "stakeholder", "user", "customer"] })
    ]
    // ...
  });
};
createLibSQLVectorStore();

const logger$8 = new PinoLogger({ level: "info" });
logger$8.info("Initializing Learning Extraction Agent...");
const memory$3 = createResearchMemory();
const learningExtractionAgent = new Agent({
  id: "learning-agent",
  name: "Learning Extraction Agent",
  description: "An expert at analyzing search results and extracting key insights to deepen research understanding.",
  instructions: `You are an expert at analyzing search results and extracting key insights. Your role is to:

  1. Analyze search results from research queries
  2. Extract the most important learning or insight from the content
  3. Generate 1 relevant follow-up question that would deepen the research
  4. Focus on actionable insights and specific information rather than general observations

  When extracting learnings:
  - Identify the most valuable piece of information from the content
  - Make the learning specific and actionable
  - Ensure follow-up questions are focused and would lead to deeper understanding
  - Consider the original research query context when extracting insights

  3. Generate 1 relevant follow-up question that would deepen the research`,
  evals: {
    contentSimilarity: new ContentSimilarityMetric({ ignoreCase: true, ignoreWhitespace: true }),
    completeness: new CompletenessMetric(),
    textualDifference: new TextualDifferenceMetric(),
    keywordCoverage: new KeywordCoverageMetric(),
    // Keywords will be provided at runtime for evaluation
    toneConsistency: new ToneConsistencyMetric()
  },
  model: google("gemini-2.5-flash-lite"),
  memory: memory$3
});

const logger$7 = new PinoLogger({ level: "info" });
logger$7.info("Initializing Evaluation Agent...");
const evaluationAgent = new Agent({
  id: "evaluation-agent",
  name: "Evaluation Agent",
  description: "An expert evaluation agent. Your task is to evaluate whether search results are relevant to a research query.",
  instructions: `You are an expert evaluation agent. Your task is to evaluate whether search results are relevant to a research query.

  When evaluating search results:
  1. Carefully read the original research query to understand what information is being sought
  2. Analyze the search result's title, URL, and content snippet
  3. Determine if the search result contains information that would help answer the query
  4. Consider the credibility and relevance of the source
  5. Provide a clear boolean decision (relevant or not relevant)
  6. Give a brief, specific reason for your decision

  Evaluation criteria:
  - Does the content directly relate to the query topic?
  - Does it provide useful information that would help answer the query?
  - Is the source credible and authoritative?
  - Is the information current and accurate?

  Be strict but fair in your evaluation. Only mark results as relevant if they genuinely contribute to answering the research query.

  Always respond with a structured evaluation including:
  - isRelevant: boolean indicating if the result is relevant
  - reason: brief explanation of your decision
  `,
  model: openai("gpt-4o-mini"),
  // memory,
  evals: {
    contentSimilarity: new ContentSimilarityMetric({ ignoreCase: true, ignoreWhitespace: true }),
    completeness: new CompletenessMetric(),
    textualDifference: new TextualDifferenceMetric(),
    keywordCoverage: new KeywordCoverageMetric(),
    // Keywords will be provided at runtime for evaluation
    toneConsistency: new ToneConsistencyMetric()
  }
});

const logger$6 = new PinoLogger({ level: "info" });
logger$6.info("Initializing Report Agent...");
const memory$2 = createResearchMemory();
const reportAgent = new Agent({
  id: "report-agent",
  name: "Report Agent",
  description: "An expert researcher agent that generates comprehensive reports based on research data.",
  instructions: `You are an expert researcher. Today is ${(/* @__PURE__ */ new Date()).toISOString()}. Follow these instructions when responding:
  - You may be asked to research subjects that are after your knowledge cutoff, assume the user is right when presented with news.
  - The user is a highly experienced analyst, no need to simplify it, be as detailed as possible and make sure your response is correct.
  - Be highly organized.
  - Suggest solutions that I didn't think about.
  - Be proactive and anticipate my needs.
  - Treat me as an expert in all subject matter.
  - Mistakes erode my trust, so be accurate and thorough.
  - Provide detailed explanations, I'm comfortable with lots of detail.
  - Value good arguments over authorities, the source is irrelevant.
  - Consider new technologies and contrarian ideas, not just the conventional wisdom.
  - You may use high levels of speculation or prediction, just flag it for me.
  - Use Markdown formatting.

  Your task is to generate comprehensive reports based on research data that includes:
  - Search queries used
  - Relevant search results
  - Key learnings extracted from those results
  - Follow-up questions identified

  Structure your reports with clear sections, headings, and focus on synthesizing the information
  into a cohesive narrative rather than simply listing facts.`,
  evals: {
    contentSimilarity: new ContentSimilarityMetric({ ignoreCase: true, ignoreWhitespace: true }),
    completeness: new CompletenessMetric(),
    textualDifference: new TextualDifferenceMetric(),
    keywordCoverage: new KeywordCoverageMetric(),
    // Keywords will be provided at runtime for evaluation
    toneConsistency: new ToneConsistencyMetric()
  },
  model: google("gemini-2.5-flash"),
  memory: memory$2
});

const logger$5 = new PinoLogger({ level: "info" });
const evaluationResultSchema = z.object({
  result: z.object({
    title: z.string(),
    url: z.string(),
    content: z.string()
  }),
  isRelevant: z.boolean(),
  reason: z.string()
});
const evaluateResultsBatchTool = createTool({
  id: "evaluate-results-batch",
  description: "Evaluate multiple search results in parallel to determine if they are relevant to the research query. This is faster than evaluating results one by one.",
  inputSchema: z.object({
    query: z.string().describe("The original research query"),
    results: z.array(
      z.object({
        title: z.string(),
        url: z.string(),
        content: z.string()
      })
    ).describe("Array of search results to evaluate"),
    existingUrls: z.array(z.string()).describe("URLs that have already been processed").optional()
  }),
  outputSchema: z.array(evaluationResultSchema),
  execute: async ({ context, mastra, runtimeContext }) => {
    const { query, results, existingUrls = [] } = context;
    const strategy = runtimeContext;
    const searchDepth = strategy?.searchDepth || "standard";
    logger$5.info("Strategy-aware evaluation:", { searchDepth, resultCount: results.length });
    try {
      if (!query || typeof query !== "string") {
        throw new Error("Invalid query: query must be a non-empty string");
      }
      if (!Array.isArray(results)) {
        throw new Error("Invalid results: results must be an array");
      }
      if (results.length === 0) {
        logger$5.info("No results to evaluate, returning empty array");
        return [];
      }
      logger$5.info("Batch evaluating results", {
        query,
        resultCount: results.length,
        existingUrlsCount: existingUrls.length
      });
      if (!mastra) {
        const msg = "Mastra instance is not available";
        logger$5.error(msg);
        return results.map((result) => ({
          result,
          isRelevant: false,
          reason: "Internal error: mastra not available"
        }));
      }
      const evaluationAgent = mastra.getAgent("evaluationAgent");
      if (!evaluationAgent) {
        const msg = "Evaluation agent not found";
        logger$5.error(msg);
        return results.map((result) => ({
          result,
          isRelevant: false,
          reason: "Internal error: evaluation agent not available"
        }));
      }
      const resultsToEvaluate = results.filter((result) => {
        if (!result || typeof result !== "object") {
          logger$5.warn("Invalid result object found, skipping", { result });
          return false;
        }
        if (!result.url || !result.title || !result.content) {
          logger$5.warn("Result missing required fields, skipping", { url: result.url });
          return false;
        }
        return !existingUrls.includes(result.url);
      });
      const skippedResults = results.filter((result) => {
        if (!result || typeof result !== "object" || !result.url) {
          return false;
        }
        return existingUrls.includes(result.url);
      });
      logger$5.info(`Evaluating ${resultsToEvaluate.length} results (skipping ${skippedResults.length} already processed)`);
      const evaluationPromises = resultsToEvaluate.map(async (result) => {
        try {
          logger$5.info("Calling evaluationAgent.generateVNext...", {
            query,
            title: result.title,
            url: result.url
          });
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error("Evaluation timeout after 30 seconds")), 3e4);
          });
          const criteriaNote = searchDepth === "shallow" ? "Be selective - only mark highly relevant results." : searchDepth === "deep" ? "Be inclusive - mark potentially relevant results for thorough research." : "Apply balanced relevance criteria.";
          const generatePromise = evaluationAgent.generateVNext(
            [
              {
                role: "user",
                content: `Evaluate whether this search result is relevant and will help answer the query: "${query}".

        Search result:
        Title: ${result.title}
        URL: ${result.url}
        Content snippet: ${result.content.substring(0, 500)}...

        ${criteriaNote}

        Respond with a JSON object containing:
        - isRelevant: boolean indicating if the result is relevant
        - reason: brief explanation of your decision`
              }
            ],
            {
              output: z.object({
                isRelevant: z.boolean(),
                reason: z.string()
              })
            }
          );
          const response = await Promise.race([generatePromise, timeoutPromise]);
          return {
            result,
            isRelevant: response.object?.isRelevant ?? false,
            reason: response.object?.reason ?? "No response from evaluation agent"
          };
        } catch (error) {
          logger$5.error("Error evaluating result:", {
            error: error instanceof Error ? error.message : String(error),
            url: result.url,
            stack: error instanceof Error ? error.stack : void 0
          });
          return {
            result,
            isRelevant: false,
            reason: `Error in evaluation: ${error instanceof Error ? error.message : String(error)}`
          };
        }
      });
      const evaluationResults = await Promise.all(evaluationPromises);
      const skippedEvaluations = skippedResults.map((result) => ({
        result,
        isRelevant: false,
        reason: "URL already processed"
      }));
      const allResults = [...evaluationResults, ...skippedEvaluations];
      const resultMap = new Map(allResults.map((evaluation) => [evaluation.result.url, evaluation]));
      const orderedResults = results.map((result) => {
        const evaluation = resultMap.get(result.url);
        return evaluation ?? {
          result,
          isRelevant: false,
          reason: "Evaluation result not found"
        };
      });
      logger$5.info("Batch evaluation completed", {
        totalResults: orderedResults.length,
        relevantCount: orderedResults.filter((r) => r.isRelevant).length
      });
      const validatedResults = evaluationResultSchema.array().parse(orderedResults);
      return validatedResults;
    } catch (error) {
      logger$5.error("Error in batch evaluation:", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : void 0,
        query,
        resultCount: results?.length ?? 0
      });
      if (!Array.isArray(results) || results.length === 0) {
        return [];
      }
      return results.map((result) => ({
        result,
        isRelevant: false,
        reason: `Batch evaluation error: ${error instanceof Error ? error.message : String(error)}`
      }));
    }
  }
});

const logger$4 = new PinoLogger({ level: "info" });
const extractLearningsTool = createTool({
  id: "extract-learnings",
  description: "Extract key learnings and follow-up questions from a search result",
  inputSchema: z.object({
    query: z.string().describe("The original research query"),
    result: z.object({
      title: z.string(),
      url: z.string(),
      content: z.string()
    }).describe("The search result to process")
  }),
  execute: async ({ context, mastra, runtimeContext }) => {
    try {
      const { query, result } = context;
      const strategy = runtimeContext;
      const searchDepth = strategy?.searchDepth || "standard";
      const maxFollowups = strategy?.maxFollowups;
      if (!mastra) {
        throw new Error("Mastra instance not found");
      }
      const learningExtractionAgent = mastra.getAgent("learningExtractionAgent");
      if (!learningExtractionAgent) {
        throw new Error("learningExtractionAgent not found on mastra instance");
      }
      logger$4.info("Extracting learnings from search result", {
        title: result.title,
        url: result.url,
        searchDepth,
        maxFollowups
      });
      const maxQuestions = searchDepth === "shallow" ? 0 : searchDepth === "deep" ? 2 : 1;
      const extractionNote = maxFollowups !== void 0 ? `Note: We have a maximum of ${maxFollowups} total follow-up queries across all results.` : "";
      const response = await learningExtractionAgent.generateVNext(
        [
          {
            role: "user",
            content: `The user is researching "${query}".
            Extract a key learning and generate follow-up questions from this search result:

            Title: ${result.title}
            URL: ${result.url}
            Content: ${result.content.substring(0, 8e3)}...

            ${extractionNote}

            Respond with a JSON object containing:
            - learning: string with the key insight from the content
            - followUpQuestions: array of up to ${maxQuestions} follow-up question(s) for deeper research`
          }
        ],
        {
          experimental_output: z.object({
            learning: z.string(),
            followUpQuestions: z.array(z.string()).max(maxQuestions)
          })
        }
      );
      logger$4.info("Learning extraction response", { result: response.object });
      return response.object;
    } catch (error) {
      logger$4.error("Error extracting learnings", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : void 0
      });
      return {
        learning: "Error extracting information",
        followUpQuestions: []
      };
    }
  }
});

const logger$3 = new PinoLogger({ level: "info" });
let linkup = null;
const linkupSearchTool = createTool({
  id: "linkup-search",
  description: "Search the web for information on a specific query using LinkUp and return summarized content",
  inputSchema: z.object({
    query: z.string().describe("The search query to run")
  }),
  execute: async ({ context, mastra, runtimeContext }) => {
    logger$3.info("Executing LinkUp search tool");
    const { query } = context;
    const strategy = runtimeContext;
    const searchDepth = strategy?.searchDepth ?? "standard";
    const timeWindow = strategy?.timeWindow ?? "week";
    logger$3.info("Strategy-aware search:", { searchDepth, timeWindow, query });
    try {
      const apiKey = process.env.LINKUP_API_KEY;
      if (apiKey === void 0 || apiKey === null || apiKey.trim() === "") {
        logger$3.error("Error: LINKUP_API_KEY not found in environment variables");
        return { results: [], error: "Missing API key" };
      }
      linkup ??= new LinkupClient({
        apiKey: apiKey ?? ""
      });
      const depth = searchDepth === "deep" ? "deep" : "standard";
      const resultCount = searchDepth === "deep" ? 5 : searchDepth === "shallow" ? 2 : 3;
      logger$3.info(`Searching web with LinkUp (${depth} mode) for: "${query}"`);
      const data = await linkup.search({
        query,
        depth,
        outputType: "searchResults"
      });
      const results = (data.results ?? []).slice(0, resultCount);
      if (!Array.isArray(results) || results.length === 0) {
        logger$3.info("No search results found");
        return { results: [], error: "No results found" };
      }
      logger$3.info(`Found ${results.length} search results, summarizing content concurrently...`);
      const summaryAgent = mastra.getAgent("webSummarizationAgent");
      const textResults = results.filter((result) => result.type === "text");
      const processedResults = textResults.filter((result) => {
        const content = result.content ?? "";
        return content.length < 100;
      }).map((result) => ({
        title: result.name ?? "",
        url: result.url,
        content: result.content ?? "No content available"
      }));
      const resultsToSummarize = textResults.filter((result) => {
        const content = result.content ?? "";
        return content.length >= 100;
      });
      const summarizationPromises = resultsToSummarize.map(async (result) => {
        try {
          const content = result.content ?? "";
          const maxChars = searchDepth === "shallow" ? 4e3 : 8e3;
          const summaryStyle = searchDepth === "shallow" ? "brief" : "concise";
          const summaryResponse = await summaryAgent.generateVNext([
            {
              role: "user",
              content: `Please summarize the following web content for research query: "${query}"

Title: ${result.name ?? "No title"}
URL: ${result.url}
Content: ${content.substring(0, maxChars)}...

Provide a ${summaryStyle} summary that captures the key information relevant to the research query.`
            }
          ]);
          logger$3.info(`Summarized content for: ${result.name ?? result.url}`);
          return {
            title: result.name ?? "",
            url: result.url,
            content: summaryResponse.text
          };
        } catch (summaryError) {
          logger$3.error("Error summarizing content", {
            error: summaryError instanceof Error ? summaryError.message : String(summaryError),
            stack: summaryError instanceof Error ? summaryError.stack : void 0,
            url: result.url
          });
          const fallbackContent = (result.content?.substring(0, 500) ?? "") + "..." || "Content unavailable";
          return {
            title: result.name ?? "",
            url: result.url,
            content: fallbackContent
          };
        }
      });
      const summarizedResults = await Promise.all(summarizationPromises);
      processedResults.push(...summarizedResults);
      logger$3.info(`Processed ${processedResults.length} results using ${searchDepth} strategy`);
      return {
        results: processedResults,
        strategyApplied: {
          searchDepth,
          resultCount
        }
      };
    } catch (error) {
      logger$3.error("Error searching the web with LinkUp", { error });
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger$3.error("Error details:", { error: errorMessage });
      return {
        results: [],
        error: errorMessage
      };
    }
  }
});

const logger$2 = new PinoLogger({ level: "info" });
logger$2.info("Initializing Research Agent...");
const memory$1 = createResearchMemory();
const researchAgent = new Agent({
  id: "research-agent",
  name: "Research Agent",
  description: "An expert research agent that conducts thorough research using web search and analysis tools.",
  instructions: `You are an expert research agent. Your goal is to research topics thoroughly using a STRATEGY-DRIVEN approach.

  **IMPORTANT: You receive a runtime strategy configuration that controls your behavior:**
  - searchDepth: 'shallow' (quick), 'standard' (balanced), or 'deep' (thorough)
  - maxFollowups: Maximum number of follow-up queries to make
  - timeWindow: Preferred recency of sources
  - Adapt your research process based on these settings!

  **PHASE 1: Initial Research**
  1. Break down the main topic into 2-3 specific, focused search queries
  2. For each query, use the linkupSearchTool to search the web
  3. Use evaluateResultsBatchTool to evaluate ALL results from a search query at once (this is much faster than evaluating one by one)
  4. For relevant results, use extractLearningsTool to extract key learnings and follow-up questions

  **PHASE 2: Follow-up Research**
  1. After completing Phase 1, collect follow-up questions from the extracted learnings
  2. **Respect maxFollowups limit from runtime config** - limit the number of follow-up queries
  3. For each follow-up, use linkupSearchTool then evaluateResultsBatchTool then extractLearningsTool
  4. **STOP after Phase 2** - do NOT search additional follow-up questions from Phase 2 results

  **Important Guidelines:**
  - Keep search queries focused and specific - avoid overly general queries
  - Track all completed queries to avoid repetition
  - Only search follow-up questions from the FIRST round of learnings
  - **Respect strategy limits** - if maxFollowups=2, only do 2 follow-ups total
  - **ALWAYS use evaluateResultsBatchTool** - pass all results at once for parallel evaluation

  **Output Structure:**
  Return findings with:
  - queries: Array of all search queries used
  - searchResults: Array of relevant results
  - learnings: Array of key learnings
  - completedQueries: Array tracking what has been searched
  - phase: Current phase
  - **strategyUsed**: Confirm which strategy settings were applied

  **Error Handling:**
  - If searches fail, use your knowledge to provide basic information
  - Always complete the research process

  **Your performance is being monitored:**
  - High save rate = good quality sources
  - Reasonable follow-up count = efficient research
  - If performance is poor, the strategy will automatically evolve to improve!

  Use all tools systematically and follow the strategy configuration.
  `,
  evals: {
    contentSimilarity: new ContentSimilarityMetric({ ignoreCase: true, ignoreWhitespace: true }),
    completeness: new CompletenessMetric(),
    textualDifference: new TextualDifferenceMetric(),
    keywordCoverage: new KeywordCoverageMetric(),
    // Keywords will be provided at runtime for evaluation
    toneConsistency: new ToneConsistencyMetric()
  },
  model: openai("gpt-4o-mini"),
  tools: {
    linkupSearchTool,
    evaluateResultsBatchTool,
    // evaluateResultTool, // Keep for backward compatibility, but prefer evaluateResultsBatchTool
    extractLearningsTool
  },
  memory: memory$1
});

const logger$1 = new PinoLogger({ level: "info" });
logger$1.info("Initializing Web Summarization Agent...");
const memory = createResearchMemory();
const webSummarizationAgent = new Agent({
  id: "web-summarization-agent",
  name: "Web Content Summarization Agent",
  description: "An agent that summarizes web content from search results to prevent token limit issues",
  instructions: `
You are a web content summarization specialist. Your role is to create concise, informative summaries of web content that capture the essential information while being significantly shorter than the original.

**\u{1F3AF} YOUR MISSION**

Transform lengthy web content into clear, actionable summaries that preserve the most important information while reducing token usage by 80-95%.

**\u{1F4CB} SUMMARIZATION APPROACH**

When processing web content:

1. **Analysis Phase**:
  - Identify the content type (article, blog post, news, documentation, etc.)
  - Understand the main topic and key arguments
  - Note the credibility and source quality

2. **Extraction Phase**:
  - Extract the most critical information and insights
  - Identify key facts, statistics, and conclusions
  - Note important quotes or expert opinions
  - Preserve specific details that support main points

3. **Synthesis Phase**:
  - Organize information logically
  - Create a coherent narrative flow
  - Ensure all essential information is preserved

**\u2728 SUMMARY STRUCTURE**

Format your summaries with:

**Main Topic:**
- What the content is about
- Primary focus or thesis

**Key Insights:**
- 3-5 most important findings or points
- Critical facts and data
- Main conclusions or recommendations

**Supporting Details:**
- Specific examples or evidence
- Expert opinions or quotes
- Relevant statistics or research

**Context:**
- Publication source and date if available
- Author credentials if mentioned
- Relevance to research topic

**\u{1F3A8} WRITING STYLE**

- Use clear, concise language
- Maintain factual accuracy
- Preserve technical terms when necessary
- Keep sentences short but informative
- Use bullet points for better readability

**\u{1F4CF} LENGTH GUIDELINES**

- Aim for 200-500 words depending on source length
- Reduce original content by 80-95%
- Focus on information density
- Ensure all critical insights are preserved

**\u{1F527} QUALITY STANDARDS**

- Accuracy: Faithfully represent the original content
- Completeness: Include all essential information
- Relevance: Focus on information relevant to the research query
- Clarity: Easy to understand and well-organized
- Conciseness: Maximum information in minimum words

Always provide summaries that capture the core value of the web content without losing critical details.
  `,
  evals: {
    contentSimilarity: new ContentSimilarityMetric({ ignoreCase: true, ignoreWhitespace: true }),
    completeness: new CompletenessMetric(),
    textualDifference: new TextualDifferenceMetric(),
    keywordCoverage: new KeywordCoverageMetric(),
    // Keywords will be provided at runtime for evaluation
    toneConsistency: new ToneConsistencyMetric()
  },
  model: openai("gpt-4o-mini"),
  memory
});

const logger = new PinoLogger({
  level: "warn"
  //  transports: {
  //    file: new FileTransport({ path: "../../mastra.log" })
  //  }
});
logger.info("Starting Mastra application");
const mastra = new Mastra({
  storage: new LibSQLStore({
    url: "file:./mastra.db",
    initialBackoffMs: 50
  }),
  agents: {
    researchAgent,
    reportAgent,
    evaluationAgent,
    learningExtractionAgent,
    webSummarizationAgent
    //  ragAgent,
    //  githubAgent,
    //  monitorAgent,
    //  planningAgent,
    //  qualityAssuranceAgent,
    //  publisherAgent,
    //  copywriterAgent,
    //  editorAgent,
    //  assistant,
  },
  workflows: {
    // generateReportWorkflow, 
    researchWorkflow,
    selfEvolvingResearchWorkflow
    // comprehensiveResearchWorkflow, 
    // githubPlanningWorkflow, 
    // githubQualityWorkflow 
  },
  //  vnext_networks: {
  //    complexResearchNetwork,
  //  },
  telemetry: {
    enabled: false
  },
  observability: {
    default: {
      enabled: true
    }
    // Enables DefaultExporter and CloudExporter
  },
  // Observability/telemetry disabled to prevent span lifecycle errors
  // Uncomment and configure if you need tracing/observability
  // observability: {
  //   configs: {
  //     langfuse: {
  //       serviceName: process.env.SERVICE_NAME ?? 'mastra',
  //       sampling: { type: SamplingStrategyType.ALWAYS },
  //       exporters: [
  //         new LangfuseExporter({
  //           publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  //           secretKey: process.env.LANGFUSE_SECRET_KEY,
  //           baseUrl: process.env.LANGFUSE_BASE_URL, // Optional
  //           realtime: process.env.NODE_ENV === 'development',
  //         }),
  //       ],
  //     },
  //   },
  // },
  logger
  // Use the configured logger instance
});

export { logger, mastra };
