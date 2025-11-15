import { MemoryProcessor, createTool as createTool$1, Agent as Agent$1, Mastra } from '@mastra/core';
import { LibSQLVector, LibSQLStore, LIBSQL_PROMPT } from '@mastra/libsql';
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { PinoLogger } from '@mastra/loggers';
import { Agent } from '@mastra/core/agent';
import { google } from '@ai-sdk/google';
import { Memory } from '@mastra/memory';
import { embedMany, generateId } from 'ai';
import { ToneConsistencyMetric, KeywordCoverageMetric, TextualDifferenceMetric, CompletenessMetric, ContentSimilarityMetric } from '@mastra/evals/nlp';
import { openai } from '@ai-sdk/openai';
import { createTool } from '@mastra/core/tools';
import { LinkupClient } from 'linkup-sdk';
import * as fs from 'fs/promises';
import * as path from 'node:path';
import { AISpanType } from '@mastra/core/ai-tracing';
import * as zlib from 'zlib';
import { pipeline } from 'stream/promises';
import { MDocument, createGraphRAGTool, createVectorQueryTool } from '@mastra/rag';
import { RuntimeContext } from '@mastra/core/runtime-context';
import * as cheerio from 'cheerio';
import { CheerioCrawler, Request } from 'crawlee';
import { marked } from 'marked';
import * as fs$1 from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import Exa from 'exa-js';
import { createGeminiProvider } from 'ai-sdk-provider-gemini-cli';
import { NewAgentNetwork } from '@mastra/core/network/vNext';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { BatchPartsProcessor, UnicodeNormalizer } from '@mastra/core/processors';
import { Octokit } from '@octokit/rest';

const logger$y = new PinoLogger({ level: "info" });
const getUserQueryStep$1 = createStep({
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
      logger$y.error("Error in researchStep", { error: err.message, stack: err.stack });
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
  steps: [getUserQueryStep$1, researchStep, approvalStep]
});
researchWorkflow.then(getUserQueryStep$1).then(researchStep).then(approvalStep).commit();

const logger$x = new PinoLogger({ level: "info" });
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
        logger$x.info("Token limit reached, stopping retrieval");
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
        logger$x.warn("Duplicate research content skipped");
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
          logger$x.debug(`Retained cached semantic message (relevance: ${cachedRelevance})`);
          return true;
        } else {
          logger$x.debug(`Filtered cached episodic message (relevance: ${cachedRelevance})`);
          return false;
        }
      }
      const relevance = Math.min(1, length / 1e3);
      similarityCache.set(cacheKey, relevance);
      if (relevance >= this.threshold) {
        logger$x.debug(`Retained semantic message (relevance: ${relevance})`);
        return true;
      } else {
        logger$x.debug(`Filtered episodic message (relevance: ${relevance})`);
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
        logger$x.debug("Retained personalized research message");
        result.push(msg);
      } else {
        logger$x.debug("Filtered non-personalized message");
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
        logger$x.debug("Retained message with citation");
        result.push(msg);
      } else {
        logger$x.debug("Filtered message without citation");
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
          logger$x.debug("Retained cached multi-perspective research message");
          result.push(msg);
        } else {
          logger$x.debug("Filtered cached single-perspective message");
        }
        continue;
      }
      const multiPerspective = this.viewpoints.some((view) => content.includes(view)) || CODE_PATTERN.test(rawContent);
      patternCache.set(cacheKey, multiPerspective);
      if (multiPerspective) {
        logger$x.debug("Retained multi-perspective research message");
        result.push(msg);
      } else {
        logger$x.debug("Filtered single-perspective message");
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
        logger$x.debug("Retained temporal reasoning research message");
        result.push(msg);
      } else {
        logger$x.debug("Filtered non-temporal message");
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
        logger$x.debug("Retained uncertainty quantification research message");
        result.push(msg);
      } else {
        logger$x.debug("Filtered message without uncertainty quantification");
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
        logger$x.debug("Retained knowledge graph research message");
        result.push(msg);
      } else {
        logger$x.debug("Filtered non-graph message");
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
        logger$x.debug("Retained Bayesian belief research message");
        result.push(msg);
      } else {
        logger$x.debug("Filtered non-Bayesian message");
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
        logger$x.info("Circuit breaker attempting recovery");
      } else {
        logger$x.warn("Circuit breaker is open, skipping processing");
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
          logger$x.debug("Retained reliable research message");
          result.push(msg);
        } else {
          logger$x.debug("Filtered unreliable message");
        }
      }
      this.failureCount = 0;
      return result;
    } catch (error) {
      this.failureCount++;
      this.lastFailureTime = Date.now();
      if (this.failureCount >= this.failureThreshold) {
        this.isOpen = true;
        logger$x.error(`Circuit breaker opened after ${this.failureCount} failures`);
      }
      logger$x.error("Circuit breaker caught error in processing", {
        error: error instanceof Error ? error.message : "Unknown error",
        failureCount: this.failureCount
      });
      return messages;
    }
  }
}

const logger$w = new PinoLogger({
  name: "libsql-storage",
  level: process.env.LOG_LEVEL ?? "info"
});
const STORAGE_CONFIG = {
  DEFAULT_DIMENSION: 1536,
  // Gemini embedding-001 dimension
  DEFAULT_DATABASE_URL: "file:./deep-research.db",
  VECTOR_DATABASE_URL: "file:./vector-store.db",
  // Separate database for vector operations
  VECTOR_INDEXES: {
    RESEARCH_DOCUMENTS: "research_documents",
    REPORTS: "reports"
  }
};
const createLibSQLStore = (tracingContext) => {
  const startTime = Date.now();
  const databaseUrl = process.env.DATABASE_URL ?? STORAGE_CONFIG.DEFAULT_DATABASE_URL;
  try {
    const store = new LibSQLStore({
      url: databaseUrl,
      authToken: process.env.DATABASE_AUTH_TOKEN
    });
    const processingTime = Date.now() - startTime;
    logger$w.info("LibSQL storage initialized successfully", {
      databaseUrl: databaseUrl.replace(/authToken=[^&]*/, "authToken=***"),
      processingTime
    });
    return store;
  } catch (error) {
    const processingTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger$w.error("Failed to initialize LibSQL storage", {
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
    logger$w.info("LibSQL vector store initialized successfully", {
      databaseUrl: databaseUrl.replace(/authToken=[^&]*/, "authToken=***"),
      processingTime
    });
    return vectorStore;
  } catch (error) {
    const processingTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger$w.error("Failed to initialize LibSQL vector store", {
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
      new CitationExtractorProcessor({ component: logger$w, name: "citation-extractor" }),
      new ErrorCorrectionProcessor({ component: logger$w, name: "error-correction" }),
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
async function upsertVectors(indexName, vectors, metadata, ids, tracingContext) {
  const startTime = Date.now();
  try {
    const vectorStore = createLibSQLVectorStore();
    const mutableVectors = vectors.map((row) => Array.from(row));
    const mutableMetadata = metadata.map((m) => ({ ...m }));
    const mutableIds = Array.from(ids);
    await vectorStore.upsert({
      indexName,
      vectors: mutableVectors,
      metadata: mutableMetadata,
      ids: mutableIds
    });
    const processingTime = Date.now() - startTime;
    logger$w.info("Vectors upserted successfully", {
      indexName,
      count: vectors.length,
      processingTime
    });
    return { success: true, count: vectors.length };
  } catch (error) {
    const processingTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger$w.error("Failed to upsert vectors", {
      indexName,
      count: vectors.length,
      error: errorMessage,
      processingTime
    });
    throw new VectorStoreError(errorMessage, "upsert_vectors", {
      indexName,
      vectorCount: vectors.length,
      idsLength: ids.length
    });
  }
}
async function createVectorIndex(indexName, dimension = STORAGE_CONFIG.DEFAULT_DIMENSION, metric = "cosine", tracingContext) {
  const startTime = Date.now();
  try {
    const vectorStore = createLibSQLVectorStore();
    await vectorStore.createIndex({
      indexName,
      dimension,
      metric
    });
    const processingTime = Date.now() - startTime;
    logger$w.info("Vector index created successfully", { indexName, dimension, metric, processingTime });
    return { success: true };
  } catch (error) {
    const processingTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger$w.error("Failed to create vector index", {
      indexName,
      dimension,
      error: errorMessage,
      processingTime
    });
    throw new VectorStoreError(errorMessage, "create_vector_index", {
      indexName,
      dimension,
      metric
    });
  }
}
async function searchMemoryMessages(memory, threadId, query, topK = 5) {
  try {
    const embedder = google.textEmbedding("gemini-embedding-001");
    await embedMany({
      values: [query],
      model: embedder
    });
    const recalled = await memory.query({
      threadId,
      selectBy: {
        vectorSearchString: query
      },
      threadConfig: {
        semanticRecall: {
          topK,
          messageRange: 2,
          scope: "thread"
        }
      }
    });
    const recalledMessagesArray = Array.isArray(recalled.messages) ? recalled.messages : Array.isArray(recalled.messagesV2) ? recalled.messagesV2 : Array.isArray(recalled) ? recalled : [];
    const normalizeRole = (r) => {
      if (r === null) {
        return "user";
      }
      const s = String(r).toLowerCase();
      if (s === "system") {
        return "system";
      }
      if (s === "assistant" || s === "bot") {
        return "assistant";
      }
      if (s === "data") {
        return "data";
      }
      if (s === "user" || s === "human") {
        return "user";
      }
      return "user";
    };
    const relevantMessages = recalledMessagesArray.map((msg, idx) => {
      const msgObj = msg;
      const safeId = msgObj.id ?? `${threadId}-msg-${idx}-${Date.now()}`;
      const role = normalizeRole(msgObj.role ?? msgObj.sender ?? msgObj.roleName);
      const content = msgObj.content ?? (msgObj.parts?.map((p) => p.text ?? p.content).join("") ?? "");
      const createdAtRaw = msgObj.createdAt ?? msgObj.timestamp;
      const createdAt = typeof createdAtRaw !== "undefined" ? new Date(createdAtRaw) : void 0;
      const thread = msgObj.threadId ?? msgObj.thread_id;
      return {
        id: safeId,
        role,
        content,
        createdAt,
        threadId: thread
      };
    });
    logger$w.info("Memory search completed", {
      threadId,
      query,
      topK,
      foundMessages: relevantMessages.length
    });
    const uiMessages = relevantMessages.map((m) => {
      return {
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
        threadId: m.threadId
      };
    });
    return {
      messages: relevantMessages,
      uiMessages
    };
  } catch (error) {
    logger$w.error("Failed to search memory messages", {
      threadId,
      query,
      error: error instanceof Error ? error.message : "Unknown error"
    });
    return { messages: [], uiMessages: [] };
  }
}
class VectorStoreError extends Error {
  operation;
  context;
  constructor(message, operation, context = {}) {
    super(message);
    this.name = "VectorStoreError";
    this.operation = operation;
    this.context = context;
  }
}
createLibSQLVectorStore();
function extractChunkMetadata(chunks, extractParams) {
  const enhancedChunks = [...chunks];
  chunks.forEach((chunk, index) => {
    const enhancedMetadata = { ...chunk.metadata };
    if (extractParams.title) {
      if (typeof extractParams.title === "boolean") {
        const firstLine = chunk.content.split("\n")[0]?.trim();
        const firstSentence = chunk.content.split(/[.!?]/)[0]?.trim();
        enhancedMetadata.extractedTitle = firstLine || firstSentence || `Chunk ${index + 1}`;
      } else {
        enhancedMetadata.extractedTitle = `Advanced Title ${index + 1}`;
      }
    }
    if (extractParams.summary) {
      if (typeof extractParams.summary === "boolean") {
        enhancedMetadata.extractedSummary = `${chunk.content.substring(0, 100)}...`;
      } else {
        const summaries = {};
        if (extractParams.summary.summaries?.includes("self") ?? false) {
          summaries.self = `${chunk.content.substring(0, 150)}...`;
        }
        enhancedMetadata.extractedSummaries = summaries;
      }
    }
    if (extractParams.keywords) {
      if (typeof extractParams.keywords === "boolean") {
        const words = chunk.content.toLowerCase().match(/\b\w{4,}\b/g) ?? [];
        const wordCount = {};
        words.forEach((word) => {
          wordCount[word] = (wordCount[word] || 0) + 1;
        });
        const topKeywords = Object.entries(wordCount).sort(([, a], [, b]) => b - a).slice(0, 5).map(([word]) => word);
        enhancedMetadata.extractedKeywords = topKeywords;
      } else {
        enhancedMetadata.extractedKeywords = [`keyword1`, `keyword2`, `keyword3`];
      }
    }
    if (extractParams.questions) {
      if (typeof extractParams.questions === "boolean") {
        const questions = chunk.content.split(/[.!?]/).map((s) => s.trim()).filter((s) => s.endsWith("?")).slice(0, 3);
        enhancedMetadata.extractedQuestions = questions;
      } else {
        enhancedMetadata.extractedQuestions = [
          `What is the main topic of this chunk?`,
          `What are the key points discussed?`
        ];
      }
    }
    enhancedChunks[index] = {
      ...chunk,
      metadata: enhancedMetadata
    };
  });
  logger$w.info("Metadata extraction completed", {
    chunksProcessed: chunks.length,
    extractParams: Object.keys(extractParams)
  });
  return enhancedChunks;
}

const logger$v = new PinoLogger({ level: "info" });
logger$v.info("Initializing Learning Extraction Agent...");
const memory$c = createResearchMemory();
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
  memory: memory$c
});

const logger$u = new PinoLogger({ level: "info" });
logger$u.info("Initializing Evaluation Agent...");
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

const logger$t = new PinoLogger({ level: "info" });
logger$t.info("Initializing Report Agent...");
const memory$b = createResearchMemory();
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
  memory: memory$b
});

const logger$s = new PinoLogger({ level: "info" });
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
  execute: async ({ context, mastra }) => {
    const { query, results, existingUrls = [] } = context;
    try {
      if (!query || typeof query !== "string") {
        throw new Error("Invalid query: query must be a non-empty string");
      }
      if (!Array.isArray(results)) {
        throw new Error("Invalid results: results must be an array");
      }
      if (results.length === 0) {
        logger$s.info("No results to evaluate, returning empty array");
        return [];
      }
      logger$s.info("Batch evaluating results", {
        query,
        resultCount: results.length,
        existingUrlsCount: existingUrls.length
      });
      if (!mastra) {
        const msg = "Mastra instance is not available";
        logger$s.error(msg);
        return results.map((result) => ({
          result,
          isRelevant: false,
          reason: "Internal error: mastra not available"
        }));
      }
      const evaluationAgent = mastra.getAgent("evaluationAgent");
      if (!evaluationAgent) {
        const msg = "Evaluation agent not found";
        logger$s.error(msg);
        return results.map((result) => ({
          result,
          isRelevant: false,
          reason: "Internal error: evaluation agent not available"
        }));
      }
      const resultsToEvaluate = results.filter((result) => {
        if (!result || typeof result !== "object") {
          logger$s.warn("Invalid result object found, skipping", { result });
          return false;
        }
        if (!result.url || !result.title || !result.content) {
          logger$s.warn("Result missing required fields, skipping", { url: result.url });
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
      logger$s.info(`Evaluating ${resultsToEvaluate.length} results (skipping ${skippedResults.length} already processed)`);
      const evaluationPromises = resultsToEvaluate.map(async (result) => {
        try {
          logger$s.info("Calling evaluationAgent.generateVNext...", {
            query,
            title: result.title,
            url: result.url
          });
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error("Evaluation timeout after 30 seconds")), 3e4);
          });
          const generatePromise = evaluationAgent.generateVNext(
            [
              {
                role: "user",
                content: `Evaluate whether this search result is relevant and will help answer the query: "${query}".

        Search result:
        Title: ${result.title}
        URL: ${result.url}
        Content snippet: ${result.content.substring(0, 500)}...

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
          logger$s.error("Error evaluating result:", {
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
      logger$s.info("Batch evaluation completed", {
        totalResults: orderedResults.length,
        relevantCount: orderedResults.filter((r) => r.isRelevant).length
      });
      const validatedResults = evaluationResultSchema.array().parse(orderedResults);
      return validatedResults;
    } catch (error) {
      logger$s.error("Error in batch evaluation:", {
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

const logger$r = new PinoLogger({ level: "info" });
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
  execute: async ({ context, mastra }) => {
    try {
      const { query, result } = context;
      if (!mastra) {
        throw new Error("Mastra instance not found");
      }
      const learningExtractionAgent = mastra.getAgent("learningExtractionAgent");
      if (!learningExtractionAgent) {
        throw new Error("learningExtractionAgent not found on mastra instance");
      }
      logger$r.info("Extracting learnings from search result", { title: result.title, url: result.url });
      const response = await learningExtractionAgent.generateVNext(
        [
          {
            role: "user",
            content: `The user is researching "${query}".
            Extract a key learning and generate follow-up questions from this search result:

            Title: ${result.title}
            URL: ${result.url}
            Content: ${result.content.substring(0, 8e3)}...

            Respond with a JSON object containing:
            - learning: string with the key insight from the content
            - followUpQuestions: array of up to 1 follow-up question for deeper research`
          }
        ],
        {
          experimental_output: z.object({
            learning: z.string(),
            followUpQuestions: z.array(z.string()).max(1)
          })
        }
      );
      logger$r.info("Learning extraction response", { result: response.object });
      return response.object;
    } catch (error) {
      logger$r.error("Error extracting learnings", {
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

const logger$q = new PinoLogger({ level: "info" });
let linkup = null;
const linkupSearchTool = createTool({
  id: "linkup-search",
  description: "Search the web for information on a specific query using LinkUp and return summarized content",
  inputSchema: z.object({
    query: z.string().describe("The search query to run")
  }),
  execute: async ({ context, mastra }) => {
    logger$q.info("Executing LinkUp search tool");
    const { query } = context;
    try {
      const apiKey = process.env.LINKUP_API_KEY;
      if (apiKey === void 0 || apiKey === null || apiKey.trim() === "") {
        logger$q.error("Error: LINKUP_API_KEY not found in environment variables");
        return { results: [], error: "Missing API key" };
      }
      linkup ??= new LinkupClient({
        apiKey: apiKey ?? ""
      });
      logger$q.info(`Searching web with LinkUp for: "${query}"`);
      const data = await linkup.search({
        query,
        depth: "standard",
        // Use standard for faster results
        outputType: "searchResults"
      });
      const results = (data.results ?? []).slice(0, 3);
      if (!Array.isArray(results) || results.length === 0) {
        logger$q.info("No search results found");
        return { results: [], error: "No results found" };
      }
      logger$q.info(`Found ${results.length} search results, summarizing content concurrently...`);
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
          const summaryResponse = await summaryAgent.generateVNext([
            {
              role: "user",
              content: `Please summarize the following web content for research query: "${query}"

Title: ${result.name ?? "No title"}
URL: ${result.url}
Content: ${content.substring(0, 8e3)}...

Provide a concise summary that captures the key information relevant to the research query.`
            }
          ]);
          logger$q.info(`Summarized content for: ${result.name ?? result.url}`);
          return {
            title: result.name ?? "",
            url: result.url,
            content: summaryResponse.text
          };
        } catch (summaryError) {
          logger$q.error("Error summarizing content", {
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
      logger$q.info("Processed results:", processedResults);
      return {
        results: processedResults
      };
    } catch (error) {
      logger$q.error("Error searching the web with LinkUp", { error });
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger$q.error("Error details:", { error: errorMessage });
      return {
        results: [],
        error: errorMessage
      };
    }
  }
});

const logger$p = new PinoLogger({ level: "info" });
logger$p.info("Initializing Research Agent...");
const memory$a = createResearchMemory();
const researchAgent = new Agent({
  id: "research-agent",
  name: "Research Agent",
  description: "An expert research agent that conducts thorough research using web search and analysis tools.",
  instructions: `You are an expert research agent. Your goal is to research topics thoroughly by following this EXACT process:

  **PHASE 1: Initial Research**
  1. Break down the main topic into 2 specific, focused search queries
  2. For each query, use the linkupSearchTool to search the web
  3. Use evaluateResultsBatchTool to evaluate ALL results from a search query at once (this is much faster than evaluating one by one)
  4. For relevant results, use extractLearningsTool to extract key learnings and follow-up questions

  **PHASE 2: Follow-up Research**
  1. After completing Phase 1, collect ALL follow-up questions from the extracted learnings
  2. Search for each follow-up question using linkupSearchTool
  3. Use evaluateResultsBatchTool to evaluate ALL results from each follow-up search at once, then use extractLearningsTool on relevant results
  4. **STOP after Phase 2 - do NOT search additional follow-up questions from Phase 2 results**

  **Important Guidelines:**
  - Keep search queries focused and specific - avoid overly general queries
  - Track all completed queries to avoid repetition
  - Only search follow-up questions from the FIRST round of learnings
  - Do NOT create infinite loops by searching follow-up questions from follow-up results
  - **ALWAYS use evaluateResultsBatchTool instead of evaluateResultTool** - pass all results from a search query at once for parallel evaluation (much faster!)

  **Output Structure:**
  Return findings in JSON format with:
  - queries: Array of all search queries used (initial + follow-up)
  - searchResults: Array of relevant search results found
  - learnings: Array of key learnings extracted from results
  - completedQueries: Array tracking what has been searched
  - phase: Current phase of research ("initial" or "follow-up")
  - runtimeConfig: Applied runtime configuration settings

  **Error Handling:**
  - If all searches fail, use your knowledge to provide basic information
  - Always complete the research process even if some searches fail

  Use all the tools available to you systematically and stop after the follow-up phase.
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
  memory: memory$a
});

const logger$o = new PinoLogger({ level: "info" });
logger$o.info("Initializing Web Summarization Agent...");
const memory$9 = createResearchMemory();
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
  memory: memory$9
});

const logger$n = new PinoLogger({ level: "info" });
const processResearchResultStep = createStep({
  id: "process-research-result",
  inputSchema: z.object({
    approved: z.boolean(),
    researchData: z.any()
  }),
  outputSchema: z.object({
    report: z.string().optional(),
    completed: z.boolean()
  }),
  execute: async ({ inputData, mastra }) => {
    const approved = inputData.approved && inputData.researchData !== void 0 && inputData.researchData !== null;
    if (!approved) {
      logger$n.info("Research not approved or incomplete, ending workflow");
      return { completed: false };
    }
    try {
      logger$n.info("Generating report...");
      const agent = mastra.getAgent("reportAgent");
      const response = await agent.generate([
        {
          role: "user",
          content: `Generate a report based on this research: ${JSON.stringify(inputData.researchData)}`
        }
      ]);
      logger$n.info("Report generated successfully!");
      return { report: response.text, completed: true };
    } catch (error) {
      logger$n.error("Error generating report", { error });
      return { completed: false };
    }
  }
});
const generateReportWorkflow = createWorkflow({
  id: "generate-report-workflow",
  steps: [researchWorkflow, processResearchResultStep],
  inputSchema: z.object({}),
  outputSchema: z.object({
    report: z.string().optional(),
    completed: z.boolean()
  })
});
generateReportWorkflow.dowhile(researchWorkflow, async ({ inputData }) => {
  const isCompleted = inputData.approved;
  return !isCompleted;
}).then(processResearchResultStep).commit();

const logger$m = new PinoLogger({ name: "DataFileManager", level: "info" });
const DATA_DIR = path.join(process.cwd(), "./docs/data");
function validateDataPath(filePath) {
  const absolutePath = path.resolve(DATA_DIR, filePath);
  if (!absolutePath.startsWith(DATA_DIR)) {
    throw new Error(`Access denied: File path "${filePath}" is outside the allowed data directory.`);
  }
  return absolutePath;
}
const readDataFileTool = createTool({
  id: "read-data-file",
  description: "Reads content from a file within the data directory.",
  inputSchema: z.object({
    fileName: z.string().describe("The name of the file (relative to the data/ directory).")
  }),
  outputSchema: z.string().describe("The content of the file as a string."),
  execute: async ({ context, tracingContext }) => {
    const readSpan = tracingContext?.currentSpan?.createChildSpan({
      type: AISpanType.GENERIC,
      name: "read_data_file",
      input: { fileName: context.fileName }
    });
    try {
      const { fileName } = context;
      const fullPath = validateDataPath(fileName);
      const realFullPath = await fs.realpath(fullPath);
      if (!realFullPath.startsWith(DATA_DIR)) {
        throw new Error(`Access denied: File path "${fileName}" is outside the allowed data directory.`);
      }
      const content = await fs.readFile(realFullPath, "utf-8");
      logger$m.info(`Read file: ${fileName}`);
      readSpan?.end({ output: { fileSize: content.length } });
      return content;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      readSpan?.end({ metadata: { error: errorMessage } });
      throw error;
    }
  }
});
const writeDataFileTool = createTool({
  id: "write-data-file",
  description: "Writes content to a file within the data directory. If the file does not exist, it will be created. If it exists, its content will be overwritten.",
  inputSchema: z.object({
    fileName: z.string().describe("The name of the file (relative to the data/ directory)."),
    content: z.string().describe("The content to write to the file.")
  }),
  outputSchema: z.string().describe("A confirmation string indicating success."),
  execute: async ({ context, tracingContext }) => {
    const writeSpan = tracingContext?.currentSpan?.createChildSpan({
      type: AISpanType.GENERIC,
      name: "write_data_file",
      input: { fileName: context.fileName, contentLength: context.content.length }
    });
    try {
      const { fileName, content } = context;
      const fullPath = validateDataPath(fileName);
      const realFullPath = await fs.realpath(fullPath);
      if (!realFullPath.startsWith(DATA_DIR)) {
        throw new Error(`Access denied: File path "${fileName}" is outside the allowed data directory.`);
      }
      const realDirPath = path.dirname(realFullPath);
      if (!realDirPath.startsWith(DATA_DIR)) {
        throw new Error(`Access denied: Directory path "${realDirPath}" is outside the allowed data directory.`);
      }
      await fs.mkdir(realDirPath, { recursive: true });
      await fs.writeFile(realFullPath, content, "utf-8");
      logger$m.info(`Written to file: ${fileName}`);
      writeSpan?.end({ output: { success: true } });
      return `File ${fileName} written successfully.`;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      writeSpan?.end({ metadata: { error: errorMessage } });
      throw error;
    }
  }
});
const deleteDataFileTool = createTool({
  id: "delete-data-file",
  description: "Deletes a file within the data directory.",
  inputSchema: z.object({
    fileName: z.string().describe("The name of the file (relative to the data/ directory).")
  }),
  outputSchema: z.string().describe("A confirmation string indicating success."),
  execute: async ({ context, tracingContext }) => {
    const deleteSpan = tracingContext?.currentSpan?.createChildSpan({
      type: AISpanType.GENERIC,
      name: "delete_data_file",
      input: { fileName: context.fileName }
    });
    try {
      const { fileName } = context;
      const fullPath = validateDataPath(fileName);
      if (!fullPath.startsWith(DATA_DIR)) {
        throw new Error(`Access denied: File path "${fileName}" is outside the allowed data directory.`);
      }
      await fs.unlink(fullPath);
      logger$m.info(`Deleted file: ${fileName}`);
      deleteSpan?.end({ output: { success: true } });
      return `File ${fileName} deleted successfully.`;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      deleteSpan?.end({ metadata: { error: errorMessage } });
      throw error;
    }
  }
});
const listDataDirTool = createTool({
  id: "list-data-directory",
  description: "Lists files and directories within a specified path in the data directory.",
  inputSchema: z.object({
    dirPath: z.string().optional().describe("The path within the data directory to list (e.g., '', 'subfolder/').")
  }),
  outputSchema: z.array(z.string()).describe("An array of file and directory names."),
  execute: async ({ context, tracingContext }) => {
    const listSpan = tracingContext?.currentSpan?.createChildSpan({
      type: AISpanType.GENERIC,
      name: "list_data_directory",
      input: { dirPath: context.dirPath ?? "./docs/data" }
    });
    try {
      const { dirPath = "" } = context;
      const fullPath = validateDataPath(dirPath);
      if (!fullPath.startsWith(DATA_DIR)) {
        throw new Error(`Access denied: Directory path "${dirPath}" is outside the allowed data directory.`);
      }
      const contents = await fs.readdir(fullPath);
      logger$m.info(`Listed directory: ${dirPath}`);
      listSpan?.end({ output: { count: contents.length } });
      return contents;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      listSpan?.end({ metadata: { error: errorMessage } });
      throw error;
    }
  }
});
createTool({
  id: "copy-data-file",
  description: "Copies a file within the data directory to a new location.",
  inputSchema: z.object({
    sourceFile: z.string().describe("The source file path (relative to the data/ directory)."),
    destFile: z.string().describe("The destination file path (relative to the data/ directory).")
  }),
  outputSchema: z.string().describe("A confirmation string indicating success."),
  execute: async ({ context, tracingContext }) => {
    const copySpan = tracingContext?.currentSpan?.createChildSpan({
      type: AISpanType.GENERIC,
      name: "copy_data_file",
      input: { sourceFile: context.sourceFile, destFile: context.destFile }
    });
    try {
      const { sourceFile, destFile } = context;
      const sourcePath = validateDataPath(sourceFile);
      const destPath = validateDataPath(destFile);
      if (!sourcePath.startsWith(DATA_DIR) || !destPath.startsWith(DATA_DIR)) {
        throw new Error(`Access denied: Paths are outside the allowed data directory.`);
      }
      const destDir = path.dirname(destPath);
      await fs.mkdir(destDir, { recursive: true });
      await fs.copyFile(sourcePath, destPath);
      logger$m.info(`Copied file: ${sourceFile} to ${destFile}`);
      copySpan?.end({ output: { success: true } });
      return `File ${sourceFile} copied to ${destFile} successfully.`;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      copySpan?.end({ metadata: { error: errorMessage } });
      throw error;
    }
  }
});
createTool({
  id: "move-data-file",
  description: "Moves or renames a file within the data directory.",
  inputSchema: z.object({
    sourceFile: z.string().describe("The source file path (relative to the data/ directory)."),
    destFile: z.string().describe("The destination file path (relative to the data/ directory).")
  }),
  outputSchema: z.string().describe("A confirmation string indicating success."),
  execute: async ({ context, tracingContext }) => {
    const moveSpan = tracingContext?.currentSpan?.createChildSpan({
      type: AISpanType.GENERIC,
      name: "move_data_file",
      input: { sourceFile: context.sourceFile, destFile: context.destFile }
    });
    try {
      const { sourceFile, destFile } = context;
      const sourcePath = validateDataPath(sourceFile);
      const destPath = validateDataPath(destFile);
      if (!sourcePath.startsWith(DATA_DIR) || !destPath.startsWith(DATA_DIR)) {
        throw new Error(`Access denied: Paths are outside the allowed data directory.`);
      }
      const destDir = path.dirname(destPath);
      await fs.mkdir(destDir, { recursive: true });
      await fs.rename(sourcePath, destPath);
      logger$m.info(`Moved file: ${sourceFile} to ${destFile}`);
      moveSpan?.end({ output: { success: true } });
      return `File ${sourceFile} moved to ${destFile} successfully.`;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      moveSpan?.end({ metadata: { error: errorMessage } });
      throw error;
    }
  }
});
const searchDataFilesTool = createTool({
  id: "search-data-files",
  description: "Searches for files by name pattern or content within the data directory.",
  inputSchema: z.object({
    pattern: z.string().describe("The search pattern (regex for name or content)."),
    searchContent: z.boolean().optional().describe("Whether to search file content (default: false for name only)."),
    dirPath: z.string().optional().describe("The directory to search in (relative to data/, default: '').")
  }),
  outputSchema: z.array(z.string()).describe("An array of matching file paths."),
  execute: async ({ context, tracingContext }) => {
    const searchSpan = tracingContext?.currentSpan?.createChildSpan({
      type: AISpanType.GENERIC,
      name: "search_data_files",
      input: { pattern: context.pattern, searchContent: context.searchContent, dirPath: context.dirPath }
    });
    try {
      const { pattern, searchContent = false, dirPath = "" } = context;
      const searchPath = validateDataPath(dirPath);
      if (!searchPath.startsWith(DATA_DIR)) {
        throw new Error(`Access denied: Search path is outside the allowed data directory.`);
      }
      const MAX_PATTERN_LENGTH = 1e3;
      if (pattern.length > MAX_PATTERN_LENGTH) {
        throw new Error(`Pattern too long; maximum allowed length is ${MAX_PATTERN_LENGTH} characters.`);
      }
      const safePattern = pattern.toLowerCase();
      const results = [];
      const searchDir = async (dir) => {
        const items = await fs.readdir(dir, { withFileTypes: true });
        for (const item of items) {
          const itemPath = path.join(dir, item.name);
          const relativePath = path.relative(DATA_DIR, itemPath);
          if (item.isDirectory()) {
            await searchDir(itemPath);
          } else if (item.isFile()) {
            if (searchContent) {
              try {
                const content = await fs.readFile(itemPath, "utf-8");
                if (content.toLowerCase().includes(safePattern)) {
                  results.push(relativePath);
                }
              } catch {
              }
            } else if (item.name.toLowerCase().includes(safePattern)) {
              results.push(relativePath);
            }
          }
        }
      };
      await searchDir(searchPath);
      logger$m.info(`Searched for pattern: ${pattern} in ${dirPath}`);
      searchSpan?.end({ output: { resultCount: results.length } });
      return results;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      searchSpan?.end({ metadata: { error: errorMessage } });
      throw error;
    }
  }
});
const getDataFileInfoTool = createTool({
  id: "get-data-file-info",
  description: "Gets metadata information about a file within the data directory.",
  inputSchema: z.object({
    fileName: z.string().describe("The name of the file (relative to the data/ directory).")
  }),
  outputSchema: z.object({
    size: z.number(),
    modified: z.string(),
    created: z.string(),
    isFile: z.boolean(),
    isDirectory: z.boolean()
  }).describe("File metadata information."),
  execute: async ({ context, tracingContext }) => {
    const infoSpan = tracingContext?.currentSpan?.createChildSpan({
      type: AISpanType.GENERIC,
      name: "get_data_file_info",
      input: { fileName: context.fileName }
    });
    try {
      const { fileName } = context;
      const fullPath = validateDataPath(fileName);
      const realFullPath = await fs.realpath(fullPath);
      if (!realFullPath.startsWith(DATA_DIR)) {
        throw new Error(`Access denied: File path is outside the allowed data directory.`);
      }
      const stats = await fs.stat(realFullPath);
      logger$m.info(`Got info for file: ${fileName}`);
      const result = {
        size: stats.size,
        modified: stats.mtime.toISOString(),
        created: stats.birthtime.toISOString(),
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory()
      };
      infoSpan?.end({ output: { fileSize: stats.size, isFile: stats.isFile() } });
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      infoSpan?.end({ metadata: { error: errorMessage } });
      throw error;
    }
  }
});
createTool({
  id: "create-data-directory",
  description: "Creates a new directory within the data directory.",
  inputSchema: z.object({
    dirPath: z.string().describe("The path of the directory to create (relative to the data/ directory).")
  }),
  outputSchema: z.string().describe("A confirmation string indicating success."),
  execute: async ({ context, tracingContext }) => {
    const createDirSpan = tracingContext?.currentSpan?.createChildSpan({
      type: AISpanType.GENERIC,
      name: "create_data_directory",
      input: { dirPath: context.dirPath }
    });
    try {
      const { dirPath } = context;
      const fullPath = validateDataPath(dirPath);
      if (!fullPath.startsWith(DATA_DIR)) {
        throw new Error(`Access denied: Directory path is outside the allowed data directory.`);
      }
      await fs.mkdir(fullPath, { recursive: true });
      logger$m.info(`Created directory: ${dirPath}`);
      createDirSpan?.end({ output: { success: true } });
      return `Directory ${dirPath} created successfully.`;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      createDirSpan?.end({ metadata: { error: errorMessage } });
      throw error;
    }
  }
});
createTool({
  id: "remove-data-directory",
  description: "Removes an empty directory within the data directory.",
  inputSchema: z.object({
    dirPath: z.string().describe("The path of the directory to remove (relative to the data/ directory).")
  }),
  outputSchema: z.string().describe("A confirmation string indicating success."),
  execute: async ({ context, tracingContext }) => {
    const removeDirSpan = tracingContext?.currentSpan?.createChildSpan({
      type: AISpanType.GENERIC,
      name: "remove_data_directory",
      input: { dirPath: context.dirPath }
    });
    try {
      const { dirPath } = context;
      const fullPath = validateDataPath(dirPath);
      if (!fullPath.startsWith(DATA_DIR)) {
        throw new Error(`Access denied: Directory path is outside the allowed data directory.`);
      }
      const contents = await fs.readdir(fullPath);
      if (contents.length > 0) {
        throw new Error(`Directory ${dirPath} is not empty.`);
      }
      await fs.rmdir(fullPath);
      logger$m.info(`Removed directory: ${dirPath}`);
      removeDirSpan?.end({ output: { success: true } });
      return `Directory ${dirPath} removed successfully.`;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      removeDirSpan?.end({ metadata: { error: errorMessage } });
      throw error;
    }
  }
});
createTool({
  id: "archive-data",
  description: "Compresses files or directories within the data directory into a gzip archive.",
  inputSchema: z.object({
    sourcePath: z.string().describe("The source file or directory path (relative to the data/ directory)."),
    archiveName: z.string().describe("The name of the archive file (relative to the data/ directory, without extension).")
  }),
  outputSchema: z.string().describe("A confirmation string indicating success."),
  execute: async ({ context, tracingContext }) => {
    const archiveSpan = tracingContext?.currentSpan?.createChildSpan({
      type: AISpanType.GENERIC,
      name: "archive_data",
      input: { sourcePath: context.sourcePath, archiveName: context.archiveName }
    });
    try {
      const { sourcePath, archiveName } = context;
      const sourceFullPath = validateDataPath(sourcePath);
      const archiveFullPath = validateDataPath(archiveName + ".gz");
      if (!sourceFullPath.startsWith(DATA_DIR) || !archiveFullPath.startsWith(DATA_DIR)) {
        throw new Error(`Access denied: Paths are outside the allowed data directory.`);
      }
      const archiveDir = path.dirname(archiveFullPath);
      await fs.mkdir(archiveDir, { recursive: true });
      const { createReadStream, createWriteStream } = await import('fs');
      const gzip = zlib.createGzip();
      const sourceStream = createReadStream(sourceFullPath);
      const archiveStream = createWriteStream(archiveFullPath);
      await pipeline(sourceStream, gzip, archiveStream);
      logger$m.info(`Archived: ${sourcePath} to ${archiveName}.gz`);
      archiveSpan?.end({ output: { success: true } });
      return `File ${sourcePath} archived to ${archiveName}.gz successfully.`;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      archiveSpan?.end({ metadata: { error: errorMessage } });
      throw error;
    }
  }
});
createTool({
  id: "backup-data",
  description: "Creates a timestamped backup of a file or directory within the data directory.",
  inputSchema: z.object({
    sourcePath: z.string().describe("The source file or directory path (relative to the data/ directory)."),
    backupDir: z.string().optional().describe("The backup directory (relative to data/, default: 'backups/').")
  }),
  outputSchema: z.string().describe("A confirmation string indicating success with backup path."),
  execute: async ({ context, tracingContext }) => {
    const backupSpan = tracingContext?.currentSpan?.createChildSpan({
      type: AISpanType.GENERIC,
      name: "backup_data",
      input: { sourcePath: context.sourcePath, backupDir: context.backupDir ?? "backups" }
    });
    try {
      const { sourcePath, backupDir = "backups" } = context;
      const sourceFullPath = validateDataPath(sourcePath);
      if (!sourceFullPath.startsWith(DATA_DIR)) {
        throw new Error(`Access denied: Source path is outside the allowed data directory.`);
      }
      const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
      const sourceName = path.basename(sourcePath);
      const backupName = `${sourceName}_${timestamp}`;
      const backupFullPath = validateDataPath(path.join(backupDir, backupName));
      if (!backupFullPath.startsWith(DATA_DIR)) {
        throw new Error(`Access denied: Backup path is outside the allowed data directory.`);
      }
      const backupParentDir = path.dirname(backupFullPath);
      await fs.mkdir(backupParentDir, { recursive: true });
      await fs.cp(sourceFullPath, backupFullPath, { recursive: true });
      const relativeBackupPath = path.relative(DATA_DIR, backupFullPath);
      logger$m.info(`Backed up: ${sourcePath} to ${relativeBackupPath}`);
      backupSpan?.end({ output: { backupPath: relativeBackupPath } });
      return `Backup created: ${sourcePath} \u2192 ${relativeBackupPath}`;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      backupSpan?.end({ metadata: { error: errorMessage } });
      throw error;
    }
  }
});

const logger$l = new PinoLogger({ level: "info" });
const evaluateResultTool = createTool({
  id: "evaluate-result",
  description: "Evaluate if a search result is relevant to the research query",
  inputSchema: z.object({
    query: z.string().describe("The original research query"),
    result: z.object({
      title: z.string(),
      url: z.string(),
      content: z.string()
    }).describe("The search result to evaluate"),
    existingUrls: z.array(z.string()).describe("URLs that have already been processed").optional()
  }),
  execute: async ({ context, mastra }) => {
    try {
      const { query, result, existingUrls = [] } = context;
      logger$l.info("Evaluating result", { context });
      if (existingUrls?.includes(result.url)) {
        return {
          isRelevant: false,
          reason: "URL already processed"
        };
      }
      if (!mastra) {
        const msg = "Mastra instance is not available";
        logger$l.error(msg);
        return {
          isRelevant: false,
          reason: "Internal error: mastra not available"
        };
      }
      const evaluationAgent = mastra.getAgent("evaluationAgent");
      if (!evaluationAgent) {
        const msg = "Evaluation agent not found";
        logger$l.error(msg);
        return {
          isRelevant: false,
          reason: "Internal error: evaluation agent not available"
        };
      }
      logger$l.info("Calling evaluationAgent.generateVNext...", {
        query,
        title: result.title,
        url: result.url
      });
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Evaluation timeout after 30 seconds")), 3e4);
      });
      const generatePromise = evaluationAgent.generateVNext(
        [
          {
            role: "user",
            content: `Evaluate whether this search result is relevant and will help answer the query: "${query}".

        Search result:
        Title: ${result.title}
        URL: ${result.url}
        Content snippet: ${result.content.substring(0, 500)}...

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
      logger$l.info("Waiting for generateVNext response...");
      const response = await Promise.race([generatePromise, timeoutPromise]);
      logger$l.info("Received generateVNext response", { hasObject: response.object !== void 0 });
      return response.object;
    } catch (error) {
      logger$l.error("Error evaluating result:", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : void 0
      });
      return {
        isRelevant: false,
        reason: "Error in evaluation"
      };
    }
  }
});

const logger$k = new PinoLogger({ name: "ChunkerTool", level: "info" });
const chunkingStrategySchema = z.enum(["recursive", "sentence", "paragraph", "fixed", "semantic"]).describe("Strategy for chunking documents");
const chunkParamsSchema$1 = z.object({
  strategy: chunkingStrategySchema.default("recursive").describe("The chunking strategy to use"),
  size: z.number().int().positive().default(512).describe("Target size of each chunk in tokens/characters"),
  overlap: z.number().int().min(0).default(50).describe("Number of overlapping tokens/characters between chunks"),
  separator: z.string().default("\n").describe("Character(s) to use as chunk separator"),
  preserveStructure: z.boolean().default(true).describe("Whether to preserve document structure (headings, paragraphs)"),
  minChunkSize: z.number().int().positive().default(100).describe("Minimum size for a valid chunk"),
  maxChunkSize: z.number().int().positive().default(2048).describe("Maximum size for a chunk before forced splitting")
}).strict();
const documentTypeSchema = z.enum(["text", "html", "markdown", "json", "latex", "csv", "xml"]).describe("Type of document content");
const documentMetadataSchema = z.record(z.string(), z.any()).describe("Chunk metadata including position, type, etc.");
const documentInputSchema$1 = z.object({
  content: z.string().min(1).describe("The document content to process"),
  type: documentTypeSchema.default("text").describe("Type of document content"),
  title: z.string().optional().describe("Optional document title"),
  source: z.string().optional().describe("Source URL or file path"),
  metadata: documentMetadataSchema.optional()
}).strict();
const chunkerInputSchema = z.object({
  document: documentInputSchema$1,
  chunkParams: chunkParamsSchema$1.optional().describe("Parameters for document chunking"),
  outputFormat: z.enum(["simple", "detailed", "embeddings"]).default("detailed").describe("Format of output chunks"),
  includeStats: z.boolean().default(true).describe("Whether to include chunking statistics"),
  vectorOptions: z.object({
    createEmbeddings: z.boolean().default(false).describe("Whether to create embeddings for chunks"),
    upsertToVector: z.boolean().default(false).describe("Whether to upsert chunks to LibSQL vector store"),
    indexName: z.string().default(STORAGE_CONFIG.VECTOR_INDEXES.RESEARCH_DOCUMENTS).describe("Vector index name for upserting"),
    createIndex: z.boolean().default(true).describe("Whether to create the vector index if it does not exist")
  }).optional().describe("Vector store integration options"),
  extractParams: z.object({
    title: z.union([z.boolean(), z.object({
      nodes: z.number().optional(),
      nodeTemplate: z.string().optional(),
      combineTemplate: z.string().optional()
    })]).optional().describe("Extract document titles"),
    summary: z.union([z.boolean(), z.object({
      summaries: z.array(z.enum(["self", "prev", "next"])).optional(),
      promptTemplate: z.string().optional()
    })]).optional().describe("Extract section summaries"),
    keywords: z.union([z.boolean(), z.object({
      keywords: z.number().optional(),
      promptTemplate: z.string().optional()
    })]).optional().describe("Extract keywords from chunks"),
    questions: z.union([z.boolean(), z.object({
      questions: z.number().optional(),
      promptTemplate: z.string().optional(),
      embeddingOnly: z.boolean().optional()
    })]).optional().describe("Extract questions that chunks can answer")
  }).optional().describe("Metadata extraction parameters following Mastra ExtractParams patterns")
}).strict();
const chunkSchema = z.object({
  id: z.string().describe("Unique chunk identifier"),
  content: z.string().describe("Chunk text content"),
  index: z.number().int().min(0).describe("Position index in the document"),
  size: z.number().int().min(0).describe("Size of the chunk in characters"),
  metadata: z.record(z.string(), z.any()).describe("Chunk metadata including position, type, etc."),
  source: z.string().optional().describe("Source document identifier"),
  tokens: z.number().int().min(0).optional().describe("Estimated token count"),
  embedding: z.array(z.number()).optional().describe("Vector embedding for the chunk (384 dimensions)"),
  vectorId: z.string().optional().describe("Vector store ID if upserted to Pinecone")
}).strict();
const chunkingStatsSchema = z.object({
  totalChunks: z.number().int().min(0).describe("Total number of chunks created"),
  avgChunkSize: z.number().min(0).describe("Average chunk size in characters"),
  minChunkSize: z.number().min(0).describe("Smallest chunk size"),
  maxChunkSize: z.number().min(0).describe("Largest chunk size"),
  strategy: z.string().describe("Chunking strategy used"),
  processingTime: z.number().min(0).describe("Time taken to chunk the document in milliseconds"),
  overlap: z.number().min(0).describe("Overlap between chunks"),
  contentCoverage: z.number().min(0).max(1).describe("Percentage of original content preserved")
}).strict();
const chunkerOutputSchema = z.object({
  chunks: z.array(chunkSchema).describe("Array of document chunks with their content and metadata"),
  stats: chunkingStatsSchema.describe("Statistics about the chunking process"),
  originalLength: z.number().int().min(0).describe("Length of original document in characters"),
  totalProcessed: z.number().int().min(0).describe("Total characters processed across all chunks"),
  vectorStats: z.object({
    embeddingsCreated: z.number().int().min(0).describe("Number of embeddings created"),
    vectorsUpserted: z.number().int().min(0).describe("Number of vectors upserted to store"),
    indexName: z.string().optional().describe("Vector index used"),
    embeddingDimension: z.number().int().optional().describe("Embedding vector dimension"),
    vectorProcessingTime: z.number().min(0).optional().describe("Time taken for vector operations in milliseconds")
  }).optional().describe("Vector processing statistics")
}).strict();
const chunkerTool = createTool({
  id: "comprehensive_chunker",
  description: "Advanced document chunking tool supporting multiple formats (text, HTML, Markdown, JSON, LaTeX, CSV, XML) with configurable strategies and runtime context integration",
  inputSchema: chunkerInputSchema,
  outputSchema: chunkerOutputSchema,
  execute: async ({ context, runtimeContext, tracingContext }) => {
    const startTime = Date.now();
    try {
      const validatedInput = chunkerInputSchema.parse(context);
      logger$k.info("Document chunker input validated", {
        documentType: validatedInput.document.type,
        strategy: validatedInput.chunkParams?.strategy ?? "recursive"
      });
      const contextChunkSize = Number(runtimeContext?.get("chunk-size") ?? validatedInput.chunkParams?.size ?? 512);
      const contextOverlap = Number(runtimeContext?.get("chunk-overlap") ?? validatedInput.chunkParams?.overlap ?? 50);
      const rawStrategy = runtimeContext?.get("chunk-strategy");
      const allowedStrategies = ["recursive", "sentence", "paragraph", "fixed", "semantic"];
      let contextStrategy = validatedInput.chunkParams?.strategy ?? "recursive";
      if (typeof rawStrategy === "string" && allowedStrategies.includes(rawStrategy)) {
        contextStrategy = rawStrategy;
      }
      Boolean(runtimeContext?.get("preserve-structure") ?? validatedInput.chunkParams?.preserveStructure ?? true);
      const includeMetadata = Boolean(runtimeContext?.get("include-metadata") ?? true);
      const embedder = google.textEmbedding("gemini-embedding-001");
      let doc;
      const { content, type, title, source, metadata } = validatedInput.document;
      switch (type) {
        case "html":
          doc = MDocument.fromHTML(content, { title, source, ...metadata });
          break;
        case "markdown":
          doc = MDocument.fromMarkdown(content, { title, source, ...metadata });
          break;
        case "json":
          doc = MDocument.fromJSON(content, { title, source, ...metadata });
          break;
        case "latex": {
          const preprocessedLatex = preprocessLatex(content);
          doc = MDocument.fromText(preprocessedLatex, { title, source, type: "latex", ...metadata });
          break;
        }
        case "csv": {
          const csvText = preprocessCSV(content);
          doc = MDocument.fromText(csvText, { title, source, type: "csv", ...metadata });
          break;
        }
        case "xml": {
          const xmlText = preprocessXML(content);
          doc = MDocument.fromText(xmlText, { title, source, type: "xml", ...metadata });
          break;
        }
        case "text":
        default:
          doc = MDocument.fromText(content, { title, source, ...metadata });
          break;
      }
      const chunkConfig = {
        strategy: contextStrategy,
        size: contextChunkSize,
        overlap: contextOverlap,
        minChunkSize: validatedInput.chunkParams?.minChunkSize ?? 100,
        maxChunkSize: validatedInput.chunkParams?.maxChunkSize ?? 2048};
      let rawChunks;
      switch (chunkConfig.strategy) {
        case "recursive":
          rawChunks = await doc.chunk({
            size: chunkConfig.size,
            overlap: chunkConfig.overlap
          });
          break;
        case "sentence":
          rawChunks = await chunkBySentence(content, chunkConfig);
          break;
        case "paragraph":
          rawChunks = await chunkByParagraph(content, chunkConfig);
          break;
        case "fixed":
          rawChunks = await chunkFixed(content, chunkConfig);
          break;
        case "semantic":
          rawChunks = await chunkSemantic(content, chunkConfig);
          break;
        default:
          rawChunks = await doc.chunk({
            size: chunkConfig.size,
            overlap: chunkConfig.overlap
          });
      }
      const chunks = rawChunks.map((chunk, index) => {
        const chunkContent = chunk.content ?? chunk.text ?? chunk.pageContent ?? "";
        const chunkId = generateId();
        return {
          id: chunkId,
          content: chunkContent,
          index,
          size: chunkContent.length,
          metadata: {
            ...chunk.metadata,
            chunkIndex: index,
            strategy: chunkConfig.strategy,
            originalType: type,
            title: title ?? "Unknown",
            source: source ?? "Direct input",
            ...includeMetadata && metadata
          },
          source: source ?? title ?? `chunk-${chunkId}`,
          tokens: estimateTokenCount(chunkContent)
        };
      });
      if (validatedInput.extractParams) {
        logger$k.info("Starting metadata extraction for chunks", {
          chunkCount: chunks.length,
          extractParams: Object.keys(validatedInput.extractParams)
        });
        const enhancedChunks = extractChunkMetadata(
          chunks.map((chunk) => ({
            id: chunk.id,
            content: chunk.content,
            metadata: chunk.metadata
          })),
          validatedInput.extractParams
        );
        enhancedChunks.forEach((enhanced, index) => {
          if (chunks[index]) {
            const safeEnhancedMetadata = {};
            if (enhanced && typeof enhanced.metadata === "object" && enhanced.metadata !== null) {
              for (const key of Object.keys(enhanced.metadata)) {
                if (typeof key === "string" && !Object.hasOwn(Object.prototype, key)) {
                  safeEnhancedMetadata[key] = enhanced.metadata[key];
                }
              }
            }
            chunks[index].metadata = { ...chunks[index].metadata, ...safeEnhancedMetadata };
          }
        });
        logger$k.info("Metadata extraction completed", {
          chunkCount: chunks.length,
          extractedFields: Object.keys(validatedInput.extractParams)
        });
      }
      let vectorStats;
      const vectorStartTime = Date.now();
      if (validatedInput.vectorOptions?.createEmbeddings || validatedInput.vectorOptions?.upsertToVector) {
        const vectorProcessingSpan = tracingContext?.currentSpan ? tracingContext.currentSpan.createChildSpan({
          type: AISpanType.GENERIC,
          name: "vector_processing",
          input: {
            createEmbeddings: validatedInput.vectorOptions?.createEmbeddings,
            upsertToVector: validatedInput.vectorOptions?.upsertToVector,
            chunkCount: chunks.length
          }
        }) : void 0;
        logger$k.info("Starting vector processing for chunks", {
          createEmbeddings: validatedInput.vectorOptions?.createEmbeddings,
          upsertToVector: validatedInput.vectorOptions?.upsertToVector,
          indexName: validatedInput.vectorOptions?.indexName
        });
        const chunkTexts = chunks.map((chunk) => chunk.content);
        const { embeddings } = await embedMany({
          model: embedder,
          values: chunkTexts
        });
        chunks.forEach((chunk, index) => {
          chunk.embedding = embeddings[index];
        });
        let vectorsUpserted = 0;
        if (validatedInput.vectorOptions?.upsertToVector) {
          let indexName = validatedInput.vectorOptions.indexName || STORAGE_CONFIG.VECTOR_INDEXES.RESEARCH_DOCUMENTS;
          if (runtimeContext?.get("useReport") || validatedInput.document.metadata?.useReport) {
            indexName = STORAGE_CONFIG.VECTOR_INDEXES.REPORTS;
          }
          logger$k.info("Upserting to vector store", {
            indexName,
            profileIndexName: indexName
          });
          const vectorMetadata = chunks.map((chunk, index) => ({
            id: chunk.id,
            text: chunk.content,
            ...chunk.metadata,
            chunkIndex: index,
            totalChunks: chunks.length,
            documentType: type,
            strategy: chunkConfig.strategy
          }));
          const upsertResult = await upsertVectors(
            indexName,
            embeddings,
            vectorMetadata,
            chunks.map((chunk) => chunk.id)
          );
          if (upsertResult.success) {
            vectorsUpserted = upsertResult.count ?? 0;
            chunks.forEach((chunk) => {
              chunk.vectorId = chunk.id;
            });
          } else {
            logger$k.error("Failed to upsert vectors during chunking", {
              indexName,
              error: upsertResult.error
            });
          }
        }
        if (vectorProcessingSpan) {
          vectorProcessingSpan.end({
            output: {
              embeddingsCreated: embeddings.length,
              vectorsUpserted,
              processingTime: Date.now() - vectorStartTime
            },
            metadata: {
              operation: "vector_processing"
            }
          });
        }
        vectorStats = {
          embeddingsCreated: embeddings.length,
          vectorsUpserted,
          indexName: validatedInput.vectorOptions?.indexName,
          embeddingDimension: STORAGE_CONFIG.DEFAULT_DIMENSION,
          // Use STORAGE_CONFIG.DEFAULT_DIMENSION
          vectorProcessingTime: Date.now() - vectorStartTime
        };
        logger$k.info("Vector processing completed", vectorStats);
      }
      const processingTime = Date.now() - startTime;
      const originalLength = content.length;
      const totalProcessed = chunks.reduce((sum, chunk) => sum + chunk.size, 0);
      const chunkSizes = chunks.map((c) => c.size);
      const stats = {
        totalChunks: chunks.length,
        avgChunkSize: chunks.length > 0 ? totalProcessed / chunks.length : 0,
        minChunkSize: chunks.length > 0 ? Math.min(...chunkSizes) : 0,
        maxChunkSize: chunks.length > 0 ? Math.max(...chunkSizes) : 0,
        strategy: chunkConfig.strategy,
        processingTime,
        overlap: chunkConfig.overlap,
        contentCoverage: originalLength > 0 ? Math.min(totalProcessed / originalLength, 1) : 0
      };
      const result = {
        chunks,
        stats,
        originalLength,
        totalProcessed,
        vectorStats
      };
      logger$k.info("Document chunking completed successfully", {
        totalChunks: result.chunks.length,
        strategy: chunkConfig.strategy,
        processingTime: result.stats.processingTime,
        avgChunkSize: result.stats.avgChunkSize
      });
      return chunkerOutputSchema.parse(result);
    } catch (error) {
      logger$k.error("Document chunking failed", {
        error: error instanceof Error ? error.message : String(error),
        context
      });
      throw new Error(`Document chunking failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
});
function preprocessLatex(content) {
  return content.replace(/\\[a-zA-Z]+\{[^}]*\}/g, "").replace(/\\[a-zA-Z]+/g, "").replace(/\$[^$]*\$/g, "[MATH]").replace(/\$\$[^$]*\$\$/g, "[MATH_BLOCK]").replace(/\\begin\{[^}]*\}[\s\S]*?\\end\{[^}]*\}/g, "[ENVIRONMENT]").replace(/\s+/g, " ").trim();
}
function preprocessCSV(content) {
  try {
    const lines = content.split("\n");
    if (lines.length === 0) {
      return content;
    }
    const headers = lines[0].split(",").map((h) => h.trim().replace(/"/g, ""));
    const result = [`Headers: ${headers.join(", ")}
`];
    for (let i = 1; i < Math.min(lines.length, 100); i++) {
      const values = lines[i].split(",").map((v) => v.trim().replace(/"/g, ""));
      if (values.length === headers.length) {
        const row = headers.map((header, idx) => {
          if (typeof header === "string" && Object.hasOwn(headers, idx) && !Object.hasOwn(Object.prototype, header)) {
            return `${header}: ${values[idx]}`;
          }
          return "";
        }).filter(Boolean).join(", ");
        result.push(`Row ${i}: ${row}`);
      }
    }
    return result.join("\n");
  } catch {
    return content;
  }
}
function preprocessXML(content) {
  return content.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function chunkBySentence(content, config) {
  const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const chunks = [];
  let currentChunk = "";
  let chunkIndex = 0;
  for (const sentence of sentences) {
    const trimmedSentence = sentence.trim();
    if (!trimmedSentence) {
      continue;
    }
    if (currentChunk.length + trimmedSentence.length > config.size && currentChunk.length > 0) {
      chunks.push({
        content: currentChunk.trim(),
        metadata: { strategy: "sentence", index: chunkIndex++ }
      });
      const words = currentChunk.split(" ");
      const overlapWords = words.slice(-Math.floor(config.overlap / 6));
      currentChunk = `${overlapWords.join(" ")} ${trimmedSentence}`;
    } else {
      currentChunk += (currentChunk ? " " : "") + trimmedSentence;
    }
  }
  if (currentChunk.trim()) {
    chunks.push({
      content: currentChunk.trim(),
      metadata: { strategy: "sentence", index: chunkIndex }
    });
  }
  return Promise.resolve(chunks);
}
async function chunkByParagraph(content, config) {
  const paragraphs = content.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const chunks = [];
  let currentChunk = "";
  let chunkIndex = 0;
  for (const paragraph of paragraphs) {
    const trimmedParagraph = paragraph.trim();
    if (!trimmedParagraph) {
      continue;
    }
    if (currentChunk.length + trimmedParagraph.length > config.size && currentChunk.length > 0) {
      chunks.push({
        content: currentChunk.trim(),
        metadata: { strategy: "paragraph", index: chunkIndex++ }
      });
      currentChunk = trimmedParagraph;
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + trimmedParagraph;
    }
  }
  if (currentChunk.trim()) {
    chunks.push({
      content: currentChunk.trim(),
      metadata: { strategy: "paragraph", index: chunkIndex }
    });
  }
  return chunks;
}
async function chunkFixed(content, config) {
  const chunks = [];
  let chunkIndex = 0;
  for (let i = 0; i < content.length; i += config.size - config.overlap) {
    const end = Math.min(i + config.size, content.length);
    const chunkContent = content.substring(i, end);
    if (chunkContent.trim().length >= config.minChunkSize) {
      chunks.push({
        content: chunkContent,
        metadata: {
          strategy: "fixed",
          index: chunkIndex++,
          startPos: i,
          endPos: end
        }
      });
    }
  }
  return chunks;
}
async function chunkSemantic(content, config) {
  const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const chunks = [];
  let currentChunk = "";
  let chunkIndex = 0;
  for (let i = 0; i < sentences.length; i++) {
    if (!Object.hasOwn(sentences, i)) {
      continue;
    }
    const sentence = sentences[i].trim();
    if (!sentence) {
      continue;
    }
    const isNewTopic = /^(However|Moreover|Furthermore|In addition|On the other hand|Meanwhile|Therefore|Thus|Consequently|In conclusion)/i.test(sentence);
    if (isNewTopic && currentChunk.length > config.minChunkSize) {
      chunks.push({
        content: currentChunk.trim(),
        metadata: { strategy: "semantic", index: chunkIndex++, topicBoundary: true }
      });
      currentChunk = sentence;
    } else if (currentChunk.length + sentence.length > config.maxChunkSize) {
      chunks.push({
        content: currentChunk.trim(),
        metadata: { strategy: "semantic", index: chunkIndex++, topicBoundary: false }
      });
      currentChunk = sentence;
    } else {
      currentChunk += (currentChunk ? " " : "") + sentence;
    }
  }
  if (currentChunk.trim()) {
    chunks.push({
      content: currentChunk.trim(),
      metadata: { strategy: "semantic", index: chunkIndex, topicBoundary: false }
    });
  }
  return chunks;
}
function estimateTokenCount(text) {
  return Math.ceil(text.length / 4);
}
const chunkerRuntimeContext = new RuntimeContext();
chunkerRuntimeContext.set("user-id", "anonymous");
chunkerRuntimeContext.set("session-id", `session-${Date.now()}`);
chunkerRuntimeContext.set("chunk-strategy", "recursive");
chunkerRuntimeContext.set("chunk-size", 512);
chunkerRuntimeContext.set("chunk-overlap", 50);
chunkerRuntimeContext.set("preserve-structure", true);
chunkerRuntimeContext.set("include-metadata", true);
chunkerRuntimeContext.set("processing-priority", "balanced");
chunkerRuntimeContext.set("cache-chunks", true);
chunkerRuntimeContext.set("max-processing-time", 3e4);

const logger$j = new PinoLogger({ name: "GraphRAGTool" });
const documentInputSchema = z.object({
  text: z.string().min(1).describe("The document text content to process"),
  type: z.enum(["text", "html", "markdown", "json", "latex"]).default("text").describe("Type of document content"),
  metadata: z.record(z.string(), z.unknown()).optional().describe("Metadata associated with the document")
}).strict();
const chunkParamsSchema = z.object({
  strategy: z.enum(["recursive"]).default("recursive").describe("The chunking strategy to use"),
  size: z.number().int().positive().default(512).describe("Target size of each chunk in tokens/characters"),
  overlap: z.number().int().min(0).default(50).describe("Number of overlapping tokens/characters between chunks"),
  separator: z.string().default("\n").describe("Character(s) to use as chunk separator")
}).strict();
const upsertInputSchema = z.object({
  document: documentInputSchema,
  chunkParams: chunkParamsSchema.optional(),
  extractParams: z.custom().optional().describe("Metadata extraction parameters"),
  useReport: z.boolean().optional().describe("Whether to use report index"),
  indexName: z.string().default(STORAGE_CONFIG.VECTOR_INDEXES.RESEARCH_DOCUMENTS).describe("Name of the index to upsert to"),
  createIndex: z.boolean().default(true).describe("Whether to create the index if it does not exist"),
  vectorProfile: z.enum(["libsql"]).default("libsql").describe("Vector profile to use for embeddings and upserting")
}).strict();
const upsertOutputSchema = z.object({
  success: z.boolean().describe("Whether the upsert operation was successful"),
  chunksProcessed: z.number().int().min(0).describe("Number of chunks processed and upserted"),
  indexName: z.string().describe("Name of the index used"),
  processingTime: z.number().min(0).describe("Time taken to process and upsert in milliseconds"),
  chunkIds: z.array(z.string()).describe("Array of chunk IDs that were upserted")
}).strict();
const queryInputSchema = z.object({
  query: z.string().min(1).describe("The query to search for relationships and patterns"),
  indexName: z.string().default(STORAGE_CONFIG.VECTOR_INDEXES.RESEARCH_DOCUMENTS).describe("Name of the index to upsert to"),
  topK: z.number().int().positive().default(10).describe("Number of results to return"),
  threshold: z.number().min(0).max(1).default(0.7).describe("Similarity threshold for graph connections"),
  includeVector: z.boolean().default(false).describe("Whether to include vector data in results"),
  minScore: z.number().min(0).max(1).default(0).describe("Minimum similarity score threshold"),
  vectorProfile: z.enum(["libsql"]).default("libsql").describe("Vector profile to use for embeddings and querying"),
  filter: z.record(z.string(), z.unknown()).optional().describe("Optional metadata filter using Upstash-compatible MongoDB/Sift query syntax"),
  // Add filter field
  useReport: z.boolean().optional().describe("Whether to use report index")
}).strict();
const queryResultSchema = z.object({
  id: z.string().describe("Unique chunk/document identifier"),
  score: z.number().describe("Similarity score for this retrieval"),
  content: z.string().describe("The chunk content"),
  metadata: z.record(z.string(), z.unknown()).describe("All metadata fields"),
  // Fixed z.any() to z.unknown()
  vector: z.array(z.number()).optional().describe("Embedding vector if requested")
}).strict();
const queryOutputSchema = z.object({
  relevantContext: z.string().describe("Combined text from the most relevant document chunks"),
  sources: z.array(queryResultSchema).describe("Array of full retrieval result objects with metadata and similarity scores"),
  totalResults: z.number().int().min(0).describe("Total number of results found"),
  graphStats: z.object({
    nodes: z.number().int().min(0).describe("Number of nodes in the graph"),
    edges: z.number().int().min(0).describe("Number of edges in the graph"),
    avgScore: z.number().min(0).describe("Average similarity score")
  }).describe("Statistics about the graph structure"),
  processingTime: z.number().min(0).describe("Time taken to process the query in milliseconds")
}).strict();
const graphRAGUpsertTool = createTool({
  id: "graph_rag_upsert",
  description: "Chunk documents, create embeddings, and upsert them to the LibSQL Vector store for GraphRAG retrieval",
  inputSchema: upsertInputSchema,
  outputSchema: upsertOutputSchema,
  execute: async ({ input, runtimeContext, tracingContext }) => {
    const startTime = Date.now();
    try {
      const validatedInput = upsertInputSchema.parse(input);
      let effectiveIndexName = validatedInput.useReport ?? false ? STORAGE_CONFIG.VECTOR_INDEXES.REPORTS : validatedInput.indexName;
      const docMetadata = validatedInput.document.metadata;
      const docUseReport = docMetadata ? docMetadata.useReport : void 0;
      if (typeof docUseReport === "boolean" && docUseReport || runtimeContext?.get("useReport")) {
        effectiveIndexName = STORAGE_CONFIG.VECTOR_INDEXES.REPORTS;
      }
      const rawUserId = runtimeContext?.get("userId");
      const userId = typeof rawUserId === "string" && rawUserId.length > 0 ? rawUserId : "anonymous";
      const rawSessionId = runtimeContext?.get("sessionId");
      const sessionId = typeof rawSessionId === "string" && rawSessionId.length > 0 ? rawSessionId : "default";
      const rawDebug = runtimeContext?.get("debug");
      const debug = typeof rawDebug === "boolean" ? rawDebug : false;
      const vectorProfileName = validatedInput.vectorProfile || "libsql";
      const embedder = google.textEmbedding("gemini-embedding-001");
      if (debug) {
        logger$j.info("Starting document upsert", {
          textLength: validatedInput.document.text.length,
          type: validatedInput.document.type,
          indexName: validatedInput.indexName,
          userId,
          sessionId,
          vectorProfile: vectorProfileName
        });
      }
      const normalizeSummary = (s) => {
        if (s === void 0 || typeof s === "boolean") {
          return s;
        }
        const maybe = s;
        const allowed = /* @__PURE__ */ new Set(["self", "prev", "next"]);
        const summaries = Array.isArray(maybe.summaries) ? maybe.summaries.filter((it) => typeof it === "string" && allowed.has(it)) : void 0;
        return {
          ...summaries ? { summaries } : {},
          ...maybe.promptTemplate !== null ? { promptTemplate: maybe.promptTemplate } : {}
        };
      };
      const normalizeExtractParams = (ep) => {
        if (!ep) {
          return void 0;
        }
        return {
          ...typeof ep.title !== "undefined" ? { title: ep.title } : {},
          ...typeof ep.summary !== "undefined" ? { summary: normalizeSummary(ep.summary) } : {},
          ...typeof ep.keywords !== "undefined" ? { keywords: ep.keywords } : {},
          ...typeof ep.questions !== "undefined" ? { questions: ep.questions } : {}
        };
      };
      const chunkerResult = await chunkerTool.execute({
        context: {
          // Preserved original 'context' structure to avoid TS errors
          document: {
            content: validatedInput.document.text,
            type: validatedInput.document.type,
            metadata: validatedInput.document.metadata
          },
          chunkParams: validatedInput.chunkParams ? {
            strategy: validatedInput.chunkParams.strategy || "recursive",
            size: validatedInput.chunkParams.size || 512,
            overlap: validatedInput.chunkParams.overlap || 50,
            separator: validatedInput.chunkParams.separator || "\n",
            preserveStructure: true,
            minChunkSize: 100,
            maxChunkSize: 2048
          } : void 0,
          outputFormat: "detailed",
          includeStats: true,
          vectorOptions: {
            createEmbeddings: true,
            upsertToVector: false,
            // Chunker will create embeddings, we will upsert here
            indexName: effectiveIndexName,
            createIndex: validatedInput.createIndex
          },
          extractParams: normalizeExtractParams(validatedInput.extractParams)
        },
        runtimeContext,
        tracingContext
      });
      const chunks = chunkerResult.chunks.map((chunk) => ({
        text: chunk.content,
        metadata: chunk.metadata,
        embedding: chunk.embedding
      }));
      logger$j.info("Document chunked successfully", { totalChunks: chunks.length });
      let embeddings = [];
      if (chunks[0]?.embedding) {
        embeddings = chunks.map((chunk) => {
          if (chunk.embedding) {
            return chunk.embedding;
          }
          throw new Error("Expected embedding to be present on all chunks if present on the first.");
        });
      } else {
        const chunkTexts = chunks.map((chunk) => chunk.text);
        const embedResult = await embedMany({
          model: embedder,
          values: chunkTexts
        });
        embeddings = embedResult.embeddings;
      }
      if (validatedInput.createIndex) {
        const idxResult = await createVectorIndex(
          effectiveIndexName,
          STORAGE_CONFIG.DEFAULT_DIMENSION,
          // Use STORAGE_CONFIG.DEFAULT_DIMENSION
          "cosine"
        );
        if (!idxResult.success) {
          logger$j.warn("Index validation warning (may already exist)", {
            indexName: validatedInput.indexName,
            error: idxResult.error
          });
        } else {
          logger$j.info("Upstash vector index validated", { indexName: validatedInput.indexName });
        }
      }
      const chunkIds = [];
      const { chunkParams } = validatedInput;
      const { metadata } = validatedInput.document;
      const metadataArray = chunks.map((chunk, index) => {
        const chunkId = generateId();
        chunkIds.push(chunkId);
        return {
          id: chunkId,
          text: chunk.text,
          ...chunk.metadata,
          ...metadata,
          chunkIndex: index,
          totalChunks: chunks.length,
          strategy: (chunkParams ?? { strategy: "recursive" }).strategy,
          chunkSize: chunk.text.length,
          vectorProfile: vectorProfileName
          // Include vectorProfile in metadata
        };
      });
      const upsertSpan = tracingContext?.currentSpan ? tracingContext.currentSpan.createChildSpan({
        type: AISpanType.GENERIC,
        name: "rag_upsert",
        input: {
          indexName: effectiveIndexName,
          topK: 0
        }
        // Removed 'as any' to fix typing
      }) : void 0;
      const upsertRes = await upsertVectors(
        effectiveIndexName,
        embeddings,
        metadataArray,
        chunkIds
      );
      if (upsertSpan) {
        upsertSpan.end({
          output: {
            resultsFound: upsertRes.count,
            processingTime: Date.now() - startTime
          },
          metadata: { operation: "upsert" }
        });
      }
      if (!upsertRes.success) {
        throw new VectorStoreError(
          `GraphRAG upsert failed: ${upsertRes.error}`,
          "operation_failed",
          { indexName: validatedInput.indexName }
        );
      }
      const processingTime = Date.now() - startTime;
      const result = {
        success: true,
        chunksProcessed: chunks.length,
        indexName: validatedInput.indexName,
        processingTime,
        chunkIds
      };
      logger$j.info("Document upsert completed successfully", result);
      return upsertOutputSchema.parse(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger$j.error("Document upsert failed", {
        error: errorMessage,
        indexName: input.indexName || "context"
      });
      const inputWithDoc = input;
      const documentType = inputWithDoc?.document?.type;
      throw new VectorStoreError(
        `GraphRAG document upsert failed: ${errorMessage}`,
        "operation_failed",
        {
          indexName: input.indexName || "context",
          documentType,
          processingTime: Date.now() - startTime
        }
      );
    }
  }
});
const graphRAGTool = createGraphRAGTool({
  vectorStoreName: "libsqlVectorStoreInstance",
  indexName: STORAGE_CONFIG.VECTOR_INDEXES.RESEARCH_DOCUMENTS,
  // Fixed hard-coded value
  model: google.textEmbedding("gemini-embedding-001"),
  graphOptions: {
    dimension: STORAGE_CONFIG.DEFAULT_DIMENSION
    // Use default dimension from config
  }
});
const graphRAGQueryTool = createTool({
  id: "graph_rag_query",
  description: "Query the GraphRAG system for complex document relationships and patterns using graph-based retrieval",
  inputSchema: queryInputSchema,
  outputSchema: queryOutputSchema,
  execute: async ({ input, runtimeContext, tracingContext, memory }) => {
    const startTime = Date.now();
    try {
      const validatedInput = queryInputSchema.parse(input);
      const rawUserId = runtimeContext?.get("userId");
      const userId = typeof rawUserId === "string" && rawUserId.length > 0 ? rawUserId : "anonymous";
      const rawSessionId = runtimeContext?.get("sessionId");
      const sessionId = typeof rawSessionId === "string" && rawSessionId.length > 0 ? rawSessionId : "default";
      const rawDebug = runtimeContext?.get("debug");
      const debug = typeof rawDebug === "boolean" ? rawDebug : false;
      let indexName = validatedInput.useReport ?? false ? STORAGE_CONFIG.VECTOR_INDEXES.REPORTS : runtimeContext?.get("indexName") ?? validatedInput.indexName;
      if (Boolean(runtimeContext?.get("useReport")) || (validatedInput.useReport ?? false)) {
        indexName = STORAGE_CONFIG.VECTOR_INDEXES.REPORTS;
      }
      const rawTopK = runtimeContext?.get("topK");
      const topK = typeof rawTopK === "number" && Number.isFinite(rawTopK) ? rawTopK : validatedInput.topK;
      const rawThreshold = runtimeContext?.get("threshold");
      const threshold = typeof rawThreshold === "number" && Number.isFinite(rawThreshold) ? rawThreshold : validatedInput.threshold;
      const vectorProfileName = validatedInput.vectorProfile || "libsql";
      if (debug) {
        logger$j.info("Starting GraphRAG query", {
          query: validatedInput.query,
          indexName,
          topK,
          threshold,
          userId,
          sessionId,
          vectorProfile: vectorProfileName
        });
      }
      let memoryResults = { messages: []};
      if (typeof memory !== "undefined" && memory) {
        memoryResults = await searchMemoryMessages(
          memory,
          sessionId,
          validatedInput.query,
          topK
        );
      }
      const graphRAGContext = new RuntimeContext();
      graphRAGContext.set("indexName", indexName);
      graphRAGContext.set("topK", memoryResults.messages.length > 0 ? Math.min(topK, memoryResults.messages.length + 3) : topK);
      graphRAGContext.set("minScore", validatedInput.minScore);
      graphRAGContext.set("dimension", STORAGE_CONFIG.DEFAULT_DIMENSION);
      const graphQuerySpan = tracingContext?.currentSpan ? tracingContext.currentSpan.createChildSpan({
        type: AISpanType.GENERIC,
        name: "rag_query",
        input: {
          indexName,
          topK: validatedInput.topK
        }
        // Removed 'as any' to fix typing
      }) : void 0;
      const graphResult = await graphRAGTool.execute({
        context: {
          queryText: validatedInput.query,
          topK: graphRAGContext.get("topK") ?? validatedInput.topK,
          includeVector: validatedInput.includeVector,
          minScore: validatedInput.minScore,
          filter: validatedInput.filter
          // Pass filter to graphRAGTool.execute
        },
        runtimeContext: graphRAGContext,
        tracingContext
      });
      const enhancedSources = [
        ...graphResult.sources ?? [],
        ...(memoryResults.messages || []).slice(0, 3).map((msg) => {
          const msgMeta = msg.metadata ?? {};
          return {
            id: msg.id ?? generateId(),
            score: 0.9,
            // High score for memory relevance
            content: msg.content,
            metadata: { type: "memory", scope: "thread", ...msgMeta },
            vector: void 0
          };
        })
      ];
      const processingTime = Date.now() - startTime;
      const sources = enhancedSources.map((source) => ({
        id: source.id ?? generateId(),
        score: source.score ?? 0,
        content: source.text ?? source.content ?? "",
        metadata: source.metadata ?? {},
        vector: validatedInput.includeVector ? source.vector : void 0
      }));
      const totalResults = sources.length;
      const avgScore = totalResults > 0 ? sources.reduce((sum, s) => sum + s.score, 0) / totalResults : 0;
      if (graphQuerySpan) {
        graphQuerySpan.end({
          output: {
            resultsFound: totalResults
          },
          metadata: { operation: "query" }
        });
      }
      const result = {
        relevantContext: typeof graphResult.relevantContext === "string" && graphResult.relevantContext.length > 0 ? graphResult.relevantContext : sources.map((s) => s.content).join("\n\n"),
        sources,
        totalResults,
        graphStats: {
          nodes: totalResults,
          edges: Math.floor(totalResults * 1.5),
          // Estimated edges based on threshold
          avgScore
        },
        processingTime
      };
      logger$j.info("GraphRAG query completed successfully", {
        relevantContextLength: result.relevantContext.length,
        totalResults: result.totalResults,
        avgScore: result.graphStats.avgScore,
        processingTime: result.processingTime
      });
      return queryOutputSchema.parse(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger$j.error("GraphRAG query failed", {
        error: errorMessage,
        query: input.query,
        indexName: input.indexName
      });
      throw new VectorStoreError(
        `GraphRAG query failed: ${errorMessage}`,
        "operation_failed",
        {
          query: input.query,
          indexName: input.indexName,
          processingTime: Date.now() - startTime
        }
      );
    }
  }
});
const graphRAGRuntimeContext = new RuntimeContext();
graphRAGRuntimeContext.set("indexName", STORAGE_CONFIG.VECTOR_INDEXES.RESEARCH_DOCUMENTS);
graphRAGRuntimeContext.set("topK", 5);
graphRAGRuntimeContext.set("threshold", 0.7);
graphRAGRuntimeContext.set("minScore", 0);
graphRAGRuntimeContext.set("dimension", STORAGE_CONFIG.DEFAULT_DIMENSION);
graphRAGRuntimeContext.set("category", "document");
graphRAGRuntimeContext.set("debug", false);

const logger$i = new PinoLogger({ name: "WeatherTool", level: "info" });
const weatherTool = createTool({
  id: "get-weather",
  description: "Get current weather for a location",
  inputSchema: z.object({
    location: z.string().describe("City name")
  }),
  outputSchema: z.object({
    temperature: z.number(),
    feelsLike: z.number(),
    humidity: z.number(),
    windSpeed: z.number(),
    windGust: z.number(),
    conditions: z.string(),
    location: z.string()
  }),
  execute: async ({ context, tracingContext }) => {
    logger$i.info(`Fetching weather for location: ${context.location}`);
    const weatherSpan = tracingContext?.currentSpan?.createChildSpan({
      type: AISpanType.GENERIC,
      name: "weather_fetch",
      input: { location: context.location }
    });
    try {
      const result = await getWeather(context.location);
      weatherSpan?.end({ output: result });
      logger$i.info(`Weather fetched successfully for ${context.location}`);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      weatherSpan?.end({ metadata: { error: errorMessage } });
      logger$i.error(`Failed to fetch weather for ${context.location}: ${errorMessage}`);
      throw error;
    }
  }
});
const getWeather = async (location) => {
  const geocodingUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`;
  const geocodingResponse = await fetch(geocodingUrl);
  const geocodingData = await geocodingResponse.json();
  if (!geocodingData.results?.[0]) {
    throw new Error(`Location '${location}' not found`);
  }
  const { latitude, longitude, name } = geocodingData.results[0];
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,weather_code`;
  const response = await fetch(weatherUrl);
  const data = await response.json();
  return {
    temperature: data.current.temperature_2m,
    feelsLike: data.current.apparent_temperature,
    humidity: data.current.relative_humidity_2m,
    windSpeed: data.current.wind_speed_10m,
    windGust: data.current.wind_gusts_10m,
    conditions: getWeatherCondition(data.current.weather_code),
    location: name
  };
};
function getWeatherCondition(code) {
  const conditions = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Foggy",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Slight snow fall",
    73: "Moderate snow fall",
    75: "Heavy snow fall",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail"
  };
  return conditions[code] ?? "Unknown";
}

const logger$h = new PinoLogger({ name: "WebScraperTool", level: "info" });
const DANGEROUS_TAGS = /* @__PURE__ */ new Set([
  "script",
  "style",
  "iframe",
  "embed",
  "object",
  "noscript",
  "meta",
  "link",
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "frame",
  "frameset"
]);
const DANGEROUS_ATTRS = /* @__PURE__ */ new Set([
  "onload",
  "onerror",
  "onclick",
  "onmouseover",
  "onmouseout",
  "onkeydown",
  "onkeyup",
  "onkeypress",
  "onfocus",
  "onblur",
  "formaction"
]);
function sanitizeHtml(html) {
  try {
    const safeHtml = String(html);
    const jsdom = new JSDOM(safeHtml, { contentType: "text/html", includeNodeLocations: false });
    const { document } = jsdom.window;
    DANGEROUS_TAGS.forEach((tagName) => {
      const elements = document.querySelectorAll(tagName);
      elements.forEach((element) => element.remove());
    });
    const allElements = document.querySelectorAll("*");
    allElements.forEach((element) => {
      Array.from(element.attributes).forEach((attr) => {
        if (attr.name.startsWith("on") || DANGEROUS_ATTRS.has(attr.name.toLowerCase())) {
          element.removeAttribute(attr.name);
        }
      });
    });
    return document.body.innerHTML;
  } catch (error) {
    logger$h.warn("JSDOM sanitization failed, falling back to cheerio", { error });
    const preSanitizedHtml = String(html).replace(/<\s*(script|style|iframe|embed|object|noscript|meta|link|form|input|button|select|textarea|frame|frameset)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, "").replace(/<\s*(meta|link|input|br|hr)[^>]*\/?>/gi, "").replace(/ on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, " ").replace(/href\s*=\s*("|\\')\s*javascript:[^"\\']*\1/gi, 'href="#"');
    const $ = cheerio.load(preSanitizedHtml, { xmlMode: false });
    DANGEROUS_TAGS.forEach((tag) => $(tag).remove());
    $("*").each((_i, element) => {
      const el = $(element);
      const attrs = el.attr();
      if (attrs) {
        Object.keys(attrs).forEach((attr) => {
          if (DANGEROUS_ATTRS.has(attr.toLowerCase()) || attr.toLowerCase().startsWith("on")) {
            el.removeAttr(attr);
          }
        });
      }
    });
    return $.html();
  }
}
function extractTextContent(html) {
  try {
    const dom = new JSDOM(html, { includeNodeLocations: false });
    return dom.window.document.body.textContent?.trim() ?? "";
  } catch (error) {
    logger$h.warn("JSDOM text extraction failed, falling back to cheerio", { error });
    const $ = cheerio.load(html);
    return $.text().trim();
  }
}
function htmlToMarkdown(html) {
  try {
    const sanitizedHtml = sanitizeHtml(html);
    const dom = new JSDOM(sanitizedHtml, { includeNodeLocations: true });
    const { document } = dom.window;
    const convertNode = (node) => {
      if (node.nodeType === dom.window.Node.TEXT_NODE) {
        return node.textContent?.trim() ?? "";
      }
      if (node.nodeType === dom.window.Node.ELEMENT_NODE) {
        const element = node;
        const tagName = element.tagName.toLowerCase();
        switch (tagName) {
          case "h1":
            return `# ${getTextContent(element)}

`;
          case "h2":
            return `## ${getTextContent(element)}

`;
          case "h3":
            return `### ${getTextContent(element)}

`;
          case "h4":
            return `#### ${getTextContent(element)}

`;
          case "h5":
            return `##### ${getTextContent(element)}

`;
          case "h6":
            return `###### ${getTextContent(element)}

`;
          case "p":
            return `${getTextContent(element)}

`;
          case "br":
            return "\n";
          case "strong":
          case "b":
            return `**${getTextContent(element)}**`;
          case "em":
          case "i":
            return `*${getTextContent(element)}*`;
          case "code":
            return `\`${getTextContent(element)}\``;
          case "pre":
            return `\`\`\`
${getTextContent(element).trim()}
\`\`\`

`;
          case "a": {
            const href = element.getAttribute("href");
            const text = getTextContent(element);
            return href !== null ? `[${text}](${href})` : text;
          }
          case "ul":
            return `${convertChildren(element)}
`;
          case "ol":
            return `${convertChildren(element)}
`;
          case "li":
            return `- ${getTextContent(element)}
`;
          case "blockquote":
            return `> ${getTextContent(element)}

`;
          case "hr":
            return "---\n\n";
          case "img": {
            const srcAttr = element.getAttribute("src");
            const altAttr = element.getAttribute("alt") ?? "";
            const trimmedSrc = (srcAttr ?? "").trim();
            if (trimmedSrc === "") {
              return "";
            }
            const alt = altAttr.trim();
            return `![${alt}](${trimmedSrc})`;
          }
          case "table":
            return convertTable(element);
          default:
            return convertChildren(element);
        }
      }
      return "";
    };
    const convertChildren = (element) => {
      let result = "";
      element.childNodes.forEach((child) => {
        result += convertNode(child);
      });
      return result;
    };
    const getTextContent = (element) => {
      let result = "";
      element.childNodes.forEach((child) => {
        result += convertNode(child);
      });
      return result;
    };
    const convertTable = (table) => {
      const rows = Array.from(table.querySelectorAll("tr"));
      if (rows.length === 0) {
        return "";
      }
      let markdown = "";
      rows.forEach((row, index) => {
        const cells = Array.from(row.querySelectorAll("td, th"));
        const cellTexts = cells.map((cell) => getTextContent(cell));
        markdown += "| " + cellTexts.join(" | ") + " |\n";
        if (index === 0) {
          markdown += "| " + cellTexts.map(() => "---").join(" | ") + " |\n";
        }
      });
      return markdown + "\n";
    };
    return convertNode(document.body).trim();
  } catch (error) {
    logger$h.warn("JSDOM conversion failed, using marked fallback", { error });
    return extractTextContent(html);
  }
}
function sanitizeMarkdown(markdown) {
  try {
    return String(markdown).replace(/</g, "&lt;").replace(/>/g, "&gt;");
  } catch {
    return "";
  }
}
const HtmlProcessor = {
  DANGEROUS_TAGS,
  DANGEROUS_ATTRS,
  sanitizeHtml,
  extractTextContent,
  htmlToMarkdown,
  sanitizeMarkdown
};
class ScrapingError extends Error {
  code;
  statusCode;
  url;
  constructor(message, code, statusCode, url) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.url = url;
    this.message = `${message}${this.code ? ` (code=${this.code})` : ""}`;
    this.name = "ScrapingError";
  }
}
class ValidationUtils {
  static validateUrl(url) {
    try {
      const parsedUrl = new URL(url);
      return ["http:", "https:"].includes(parsedUrl.protocol);
    } catch {
      return false;
    }
  }
  static sanitizeFileName(fileName) {
    return fileName.replace(/[^a-zA-Z0-9\-_.]/g, "_");
  }
  static validateFilePath(filePath, intendedDir) {
    const resolvedPath = path.resolve(filePath);
    const resolvedIntendedDir = path.resolve(intendedDir);
    return resolvedPath.startsWith(resolvedIntendedDir);
  }
}
const webScraperInputSchema = z.object({
  url: z.string().url().refine((v) => ValidationUtils.validateUrl(v), "Invalid URL format"),
  selector: z.string().optional().describe("CSS selector for the elements to extract (e.g., 'h1', '.product-title'). If not provided, the entire page content will be extracted."),
  extractAttributes: z.array(z.string()).optional().describe("Array of HTML attributes to extract from selected elements (e.g., 'href', 'src', 'alt')."),
  saveMarkdown: z.boolean().optional().describe("Whether to save the scraped content as markdown to the data directory."),
  markdownFileName: z.string().optional().describe("Optional filename for the markdown file (relative to data/ directory). If not provided, a default name will be generated.")
}).strict();
const webScraperOutputSchema = z.object({
  url: z.string().url().describe("The URL that was scraped."),
  extractedData: z.array(z.record(z.string(), z.string())).describe("Array of extracted data, where each object represents an element and its extracted attributes/text."),
  rawContent: z.string().optional().describe("The full raw HTML content of the page (if no selector is provided)."),
  markdownContent: z.string().optional().describe("The scraped content converted to markdown format."),
  savedFilePath: z.string().optional().describe("Path to the saved markdown file (if saveMarkdown was true)."),
  status: z.string().describe("Status of the scraping operation (e.g., 'success', 'failed')."),
  errorMessage: z.string().optional().describe("Error message if the operation failed.")
}).strict();
const webScraperTool = createTool({
  id: "web-scraper",
  description: "Extracts structured data from web pages using JSDOM and Cheerio with enhanced security and error handling.",
  inputSchema: webScraperInputSchema,
  outputSchema: webScraperOutputSchema,
  execute: async ({ context, tracingContext }) => {
    const scrapeSpan = tracingContext?.currentSpan?.createChildSpan({
      type: AISpanType.GENERIC,
      name: "web_scrape",
      input: { url: context.url, selector: context.selector, saveMarkdown: context.saveMarkdown, extractAttributesCount: context.extractAttributes?.length ?? 0 }
    });
    logger$h.info("Starting enhanced web scraping with JSDOM", { url: context.url, selector: context.selector, saveMarkdown: context.saveMarkdown });
    let rawContent;
    let markdownContent;
    let savedFilePath;
    const extractedData = [];
    let status = "failed";
    let errorMessage;
    let scrapedUrl = context.url;
    try {
      const crawler = new CheerioCrawler({
        maxRequestsPerCrawl: 10,
        maxConcurrency: 10,
        requestHandlerTimeoutSecs: 30,
        async requestHandler({ request, body, response }) {
          try {
            scrapedUrl = request.url;
            if (typeof response?.statusCode === "number" && Number.isFinite(response.statusCode) && response.statusCode >= 400) {
              throw new ScrapingError(
                `HTTP ${response.statusCode}: ${response.statusMessage}`,
                "HTTP_ERROR",
                response.statusCode,
                request.url
              );
            }
            rawContent = body.toString();
            rawContent = HtmlProcessor.sanitizeHtml(rawContent);
            if (typeof context.selector === "string" && context.selector.trim() !== "") {
              const dom = new JSDOM(rawContent, { includeNodeLocations: false });
              const { document } = dom.window;
              const selector = context.selector.trim();
              const elements = document.querySelectorAll(selector);
              elements.forEach((element) => {
                const data = /* @__PURE__ */ new Map();
                data.set("text", element.textContent?.trim() ?? "");
                if (context.extractAttributes) {
                  context.extractAttributes.forEach((attr) => {
                    if (typeof attr === "string" && !Object.hasOwn(Object.prototype, attr) && attr !== "__proto__" && attr !== "constructor" && attr !== "prototype" && !attr.includes("<") && !attr.includes(">")) {
                      const attrValue = element.getAttribute(attr);
                      if (attrValue !== null && attrValue !== void 0) {
                        data.set(`attr_${attr}`, attrValue);
                      }
                    }
                  });
                }
                extractedData.push(Object.fromEntries(data));
              });
            }
            status = "success";
          } catch (error) {
            if (error instanceof ScrapingError) {
              throw error;
            }
            throw new ScrapingError(
              `Request handler failed: ${error instanceof Error ? error.message : String(error)}`,
              "REQUEST_HANDLER_ERROR",
              void 0,
              request.url
            );
          }
        },
        failedRequestHandler({ request, error }) {
          const scrapingError = new ScrapingError(
            `Failed to scrape ${request.url}: ${error instanceof Error ? error.message : String(error)}`,
            "REQUEST_FAILED",
            void 0,
            request.url
          );
          errorMessage = scrapingError.message;
          logger$h.error(scrapingError.message);
        }
      });
      await crawler.run([new Request({ url: context.url })]);
      if (typeof rawContent === "string" && rawContent.trim().length > 0) {
        try {
          markdownContent = HtmlProcessor.htmlToMarkdown(rawContent);
        } catch (error) {
          logger$h.warn("Enhanced HTML to markdown conversion failed, using fallback", { error: error instanceof Error ? error.message : String(error) });
          try {
            const sanitizedForMarked = HtmlProcessor.sanitizeHtml(rawContent);
            markdownContent = await marked.parse(sanitizedForMarked);
          } catch (fallbackError) {
            logger$h.warn("Fallback conversion also failed", { error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError) });
            markdownContent = HtmlProcessor.extractTextContent(rawContent);
          }
        }
        if (context.saveMarkdown === true && typeof markdownContent === "string" && markdownContent.trim() !== "") {
          try {
            const fileName = typeof context.markdownFileName === "string" && context.markdownFileName.trim() !== "" ? ValidationUtils.sanitizeFileName(context.markdownFileName) : `scraped_${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}.md`;
            const dataDir = path.join(process.cwd(), "./data");
            const fullPath = path.join(dataDir, fileName);
            if (!ValidationUtils.validateFilePath(fullPath, dataDir)) {
              throw new ScrapingError("Invalid file path", "INVALID_FILE_PATH");
            }
            await fs$1.mkdir(dataDir, { recursive: true });
            const fileHandle = await fs$1.open(fullPath, "w");
            try {
              await fileHandle.writeFile(markdownContent, "utf-8");
            } finally {
              await fileHandle.close();
            }
            savedFilePath = fileName;
            logger$h.info("Markdown content saved securely", { fileName });
          } catch (error) {
            if (error instanceof ScrapingError) {
              throw error;
            }
            logger$h.error("Failed to save markdown file", { error: error instanceof Error ? error.message : String(error) });
          }
        }
      }
      scrapeSpan?.end({
        output: {
          status,
          extractedDataCount: extractedData.length,
          contentLength: rawContent?.length ?? 0,
          savedFile: !!(typeof savedFilePath === "string" && savedFilePath.trim().length > 0)
        }
      });
    } catch (error) {
      const scrapingError = error instanceof ScrapingError ? error : new ScrapingError(
        `Web scraping failed: ${error instanceof Error ? error.message : String(error)}`,
        "GENERAL_ERROR"
      );
      errorMessage = scrapingError.message;
      logger$h.error(scrapingError.message);
      const errorMsg = scrapingError.message;
      scrapeSpan?.end({ metadata: { error: errorMsg, code: scrapingError.code } });
    }
    return webScraperOutputSchema.parse({
      url: scrapedUrl,
      extractedData,
      rawContent: context.selector !== null ? void 0 : typeof rawContent === "string" && rawContent.trim().length > 0 ? rawContent : void 0,
      markdownContent,
      savedFilePath,
      status,
      errorMessage
    });
  }
});
const batchWebScraperInputSchema = z.object({
  urls: z.array(z.string().url()).describe("Array of URLs to scrape.").max(10, "Maximum 10 URLs allowed for batch scraping"),
  selector: z.string().optional().describe("CSS selector for elements to extract from each page."),
  maxConcurrent: z.number().min(1).max(15).optional().describe("Maximum number of concurrent requests (default: 3, max: 15)."),
  saveResults: z.boolean().optional().describe("Whether to save results to data directory."),
  baseFileName: z.string().optional().describe("Base filename for saved results (default: 'batch_scrape').")
});
const batchWebScraperOutputSchema = z.object({
  results: z.array(z.object({
    url: z.string(),
    success: z.boolean(),
    extractedData: z.array(z.record(z.string(), z.string())).optional(),
    markdownContent: z.string().optional(),
    errorMessage: z.string().optional()
  })).describe("Results for each scraped URL."),
  savedFilePath: z.string().optional().describe("Path to the saved batch results file."),
  totalProcessed: z.number().describe("Total number of URLs processed."),
  successful: z.number().describe("Number of successful scrapes."),
  failed: z.number().describe("Number of failed scrapes.")
});
const batchWebScraperTool = createTool({
  id: "batch-web-scraper",
  description: "Scrape multiple web pages concurrently with enhanced JSDOM processing and rate limiting.",
  inputSchema: batchWebScraperInputSchema,
  outputSchema: batchWebScraperOutputSchema,
  execute: async ({ context, tracingContext }) => {
    const batchSpan = tracingContext?.currentSpan?.createChildSpan({
      type: AISpanType.GENERIC,
      name: "batch_web_scrape",
      input: {
        urlCount: context.urls.length,
        selector: context.selector,
        maxConcurrent: context.maxConcurrent ?? 3,
        saveResults: context.saveResults
      }
    });
    logger$h.info("Starting enhanced batch web scraping with JSDOM", {
      urlCount: context.urls.length,
      maxConcurrent: context.maxConcurrent ?? 3,
      saveResults: context.saveResults
    });
    const results = [];
    let savedFilePath;
    const maxConcurrent = Math.min(context.maxConcurrent ?? 3, 5);
    try {
      for (let i = 0; i < context.urls.length; i += maxConcurrent) {
        const batch = context.urls.slice(i, i + maxConcurrent);
        const batchPromises = batch.map(async (url) => {
          try {
            const crawler = new CheerioCrawler({
              maxRequestsPerCrawl: 1,
              requestHandlerTimeoutSecs: 20,
              async requestHandler({ body }) {
                const rawContent = body.toString();
                const sanitizedHtml = HtmlProcessor.sanitizeHtml(rawContent);
                const extractedData = [];
                if (typeof context.selector === "string" && context.selector.trim() !== "") {
                  const jsdom = new JSDOM(String(sanitizedHtml), { contentType: "text/html", includeNodeLocations: false });
                  const { document } = jsdom.window;
                  const selector = context.selector.trim();
                  const elements = document.querySelectorAll(selector);
                  elements.forEach((element) => {
                    const data = /* @__PURE__ */ new Map();
                    data.set("text", element.textContent?.trim() ?? "");
                    extractedData.push(Object.fromEntries(data));
                  });
                }
                let markdownContent = HtmlProcessor.htmlToMarkdown(sanitizedHtml);
                markdownContent = HtmlProcessor.sanitizeMarkdown(markdownContent);
                results.push({
                  url,
                  success: true,
                  extractedData,
                  markdownContent
                });
              },
              failedRequestHandler({ error }) {
                results.push({
                  url,
                  success: false,
                  errorMessage: error instanceof Error ? error.message : String(error)
                });
              }
            });
            await crawler.run([new Request({ url })]);
          } catch (error) {
            results.push({
              url,
              success: false,
              errorMessage: error instanceof Error ? error.message : String(error)
            });
          }
        });
        await Promise.all(batchPromises);
        if (i + maxConcurrent < context.urls.length) {
          await new Promise((resolve) => setTimeout(resolve, 1e3));
        }
      }
      if (context.saveResults ?? false) {
        try {
          const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
          const fileName = `${ValidationUtils.sanitizeFileName(context.baseFileName ?? "batch_scrape")}_${timestamp}.json`;
          const dataDir = path.join(process.cwd(), "./data");
          const fullPath = path.join(dataDir, fileName);
          if (!ValidationUtils.validateFilePath(fullPath, dataDir)) {
            throw new ScrapingError("Invalid file path", "INVALID_FILE_PATH");
          }
          await fs$1.mkdir(dataDir, { recursive: true });
          const fileHandle = await fs$1.open(fullPath, "w");
          try {
            await fileHandle.writeFile(JSON.stringify(results, null, 2), "utf-8");
          } finally {
            await fileHandle.close();
          }
          savedFilePath = path.relative(path.join(process.cwd(), "./data"), fullPath);
          logger$h.info("Batch results saved securely", { fileName: savedFilePath });
        } catch (error) {
          logger$h.error("Failed to save batch results", { error: error instanceof Error ? error.message : String(error) });
        }
      }
      const successful = results.filter((r) => r.success).length;
      const failed = results.length - successful;
      batchSpan?.end({
        output: {
          totalProcessed: results.length,
          successful,
          failed,
          savedFile: typeof savedFilePath === "string" && savedFilePath.trim().length > 0
        }
      });
      return batchWebScraperOutputSchema.parse({
        results,
        savedFilePath,
        totalProcessed: results.length,
        successful,
        failed
      });
    } catch (error) {
      const errorMessage = `Batch scraping failed: ${error instanceof Error ? error.message : String(error)}`;
      logger$h.error(errorMessage);
      batchSpan?.end({ metadata: { error: errorMessage } });
      throw error;
    }
  }
});
const siteMapExtractorInputSchema = z.object({
  url: z.string().url().describe("The base URL of the website to extract sitemap from.").refine((v) => ValidationUtils.validateUrl(v), "Invalid URL format"),
  maxDepth: z.number().min(1).max(5).optional().describe("Maximum depth to crawl (default: 2, max: 5)."),
  maxPages: z.number().min(1).max(200).optional().describe("Maximum number of pages to crawl (default: 50, max: 200)."),
  includeExternal: z.boolean().optional().describe("Whether to include external links (default: false)."),
  saveMap: z.boolean().optional().describe("Whether to save the site map to data directory.")
});
const siteMapExtractorOutputSchema = z.object({
  baseUrl: z.string().describe("The base URL that was crawled."),
  pages: z.array(z.object({
    url: z.string(),
    title: z.string().optional(),
    depth: z.number(),
    internalLinks: z.array(z.string()),
    externalLinks: z.array(z.string())
  })).describe("Array of discovered pages with their metadata."),
  totalPages: z.number().describe("Total number of pages discovered."),
  savedFilePath: z.string().optional().describe("Path to the saved site map file.")
});
const siteMapExtractorTool = createTool({
  id: "site-map-extractor",
  description: "Extract a comprehensive site map by crawling internal links with enhanced JSDOM processing and rate limiting.",
  inputSchema: siteMapExtractorInputSchema,
  outputSchema: siteMapExtractorOutputSchema,
  execute: async ({ context, tracingContext }) => {
    const mapSpan = tracingContext?.currentSpan?.createChildSpan({
      type: AISpanType.GENERIC,
      name: "site_map_extraction",
      input: {
        url: context.url,
        maxDepth: context.maxDepth ?? 2,
        maxPages: context.maxPages ?? 50,
        includeExternal: context.includeExternal ?? false
      }
    });
    logger$h.info("Starting enhanced site map extraction with JSDOM", {
      url: context.url,
      maxDepth: context.maxDepth ?? 2,
      maxPages: context.maxPages ?? 50
    });
    const baseUrl = new URL(context.url);
    const visited = /* @__PURE__ */ new Set();
    const pages = [];
    let savedFilePath;
    const crawlPage = async (url, depth) => {
      if (visited.has(url) || depth > (context.maxDepth ?? 2) || pages.length >= (context.maxPages ?? 50)) {
        return;
      }
      visited.add(url);
      try {
        const crawler = new CheerioCrawler({
          maxRequestsPerCrawl: 5,
          maxConcurrency: 10,
          requestHandlerTimeoutSecs: 15,
          async requestHandler({ body }) {
            const rawContent = body.toString();
            const sanitizedHtml = HtmlProcessor.sanitizeHtml(rawContent);
            const dom = new JSDOM(sanitizedHtml, { includeNodeLocations: false });
            const { document } = dom.window;
            const title = document.querySelector("title")?.textContent?.trim() ?? document.querySelector("h1")?.textContent?.trim();
            const internalLinks = [];
            const externalLinks = [];
            const links = document.querySelectorAll("a[href]");
            links.forEach((link) => {
              const href = link.getAttribute("href");
              if (href !== null && href !== void 0) {
                try {
                  const absoluteUrl = new URL(href, url).href;
                  const linkUrl = new URL(absoluteUrl);
                  if (linkUrl.hostname === baseUrl.hostname) {
                    if (!visited.has(absoluteUrl)) {
                      internalLinks.push(absoluteUrl);
                    }
                  } else if (context.includeExternal === true) {
                    externalLinks.push(absoluteUrl);
                  }
                } catch {
                }
              }
            });
            pages.push({
              url,
              title,
              depth,
              internalLinks,
              externalLinks
            });
            for (const link of internalLinks) {
              if (!visited.has(link) && pages.length < (context.maxPages ?? 50)) {
                await crawlPage(link, depth + 1);
                await new Promise((resolve) => setTimeout(resolve, 200));
              }
            }
          },
          failedRequestHandler({ error }) {
            logger$h.warn(`Failed to crawl ${url}`, { error: error instanceof Error ? error.message : String(error) });
          }
        });
        await crawler.run([new Request({ url })]);
      } catch (error) {
        logger$h.warn(`Error crawling ${url}`, { error: error instanceof Error ? error.message : String(error) });
      }
    };
    try {
      await crawlPage(context.url, 0);
      if (context.saveMap ?? false) {
        try {
          const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
          const fileName = `sitemap_${baseUrl.hostname}_${timestamp}.json`;
          const dataDir = path.join(process.cwd(), "./data");
          const fullPath = path.join(dataDir, fileName);
          if (!ValidationUtils.validateFilePath(fullPath, dataDir)) {
            throw new ScrapingError("Invalid file path", "INVALID_FILE_PATH");
          }
          await fs$1.mkdir(dataDir, { recursive: true });
          await fs$1.writeFile(fullPath, JSON.stringify({
            baseUrl: context.url,
            crawledAt: (/* @__PURE__ */ new Date()).toISOString(),
            pages
          }, null, 2), "utf-8");
          savedFilePath = path.relative(path.join(process.cwd(), "./data"), fullPath);
          logger$h.info("Site map saved securely", { fileName: savedFilePath });
        } catch (error) {
          logger$h.error("Failed to save site map", { error: error instanceof Error ? error.message : String(error) });
        }
      }
      mapSpan?.end({
        output: {
          totalPages: pages.length,
          savedFile: typeof savedFilePath === "string" && savedFilePath.trim().length > 0
        }
      });
      return siteMapExtractorOutputSchema.parse({
        baseUrl: context.url,
        pages,
        totalPages: pages.length,
        savedFilePath
      });
    } catch (error) {
      const errorMessage = `Site map extraction failed: ${error instanceof Error ? error.message : String(error)}`;
      logger$h.error(errorMessage);
      mapSpan?.end({ metadata: { error: errorMessage } });
      throw error;
    }
  }
});
const linkExtractorInputSchema = z.object({
  url: z.string().url().describe("The URL of the web page to extract links from.").refine((v) => ValidationUtils.validateUrl(v), "Invalid URL format"),
  linkTypes: z.array(z.enum(["internal", "external", "all"])).optional().describe("Types of links to extract (default: ['all'])."),
  includeAnchors: z.boolean().optional().describe("Whether to include anchor text with links (default: true)."),
  filterPatterns: z.array(z.string()).optional().describe("Regex patterns to filter links by href.")
});
const linkExtractorOutputSchema = z.object({
  url: z.string().describe("The URL that was analyzed."),
  links: z.array(z.object({
    href: z.string(),
    text: z.string(),
    type: z.enum(["internal", "external"]),
    isValid: z.boolean()
  })).describe("Array of extracted links with metadata."),
  summary: z.object({
    total: z.number(),
    internal: z.number(),
    external: z.number(),
    invalid: z.number()
  }).describe("Summary statistics of extracted links.")
});
const linkExtractorTool = createTool({
  id: "link-extractor",
  description: "Extract and analyze all links from a web page with enhanced JSDOM processing and filtering.",
  inputSchema: linkExtractorInputSchema,
  outputSchema: linkExtractorOutputSchema,
  execute: async ({ context, tracingContext }) => {
    const linkSpan = tracingContext?.currentSpan?.createChildSpan({
      type: AISpanType.GENERIC,
      name: "link_extraction",
      input: {
        url: context.url,
        linkTypes: context.linkTypes ?? ["all"],
        includeAnchors: context.includeAnchors ?? true,
        filterCount: context.filterPatterns?.length ?? 0
      }
    });
    logger$h.info("Starting enhanced link extraction with JSDOM", {
      url: context.url,
      linkTypes: context.linkTypes ?? ["all"]
    });
    try {
      let rawContent;
      let scrapedUrl = context.url;
      const crawler = new CheerioCrawler({
        maxRequestsPerCrawl: 10,
        maxConcurrency: 10,
        requestHandlerTimeoutSecs: 20,
        async requestHandler({ request, body }) {
          scrapedUrl = request.url;
          rawContent = body.toString();
        },
        failedRequestHandler({ error }) {
          throw new ScrapingError(
            `Failed to fetch ${context.url}: ${error instanceof Error ? error.message : String(error)}`,
            "FETCH_FAILED",
            void 0,
            context.url
          );
        }
      });
      await crawler.run([new Request({ url: context.url })]);
      if (typeof rawContent !== "string" || rawContent.trim().length === 0) {
        throw new ScrapingError("Failed to retrieve page content", "NO_CONTENT");
      }
      const sanitizedHtml = HtmlProcessor.sanitizeHtml(rawContent);
      const dom = new JSDOM(sanitizedHtml, { includeNodeLocations: false });
      const { document } = dom.window;
      const baseUrl = new URL(scrapedUrl);
      const links = [];
      const linkElements = document.querySelectorAll("a[href]");
      linkElements.forEach((link) => {
        const href = link.getAttribute("href");
        const text = link.textContent?.trim() ?? href ?? "";
        if (href !== null) {
          try {
            const absoluteUrl = new URL(href, scrapedUrl).href;
            const linkUrl = new URL(absoluteUrl);
            if (context.filterPatterns) {
              const matchesFilter = context.filterPatterns.some((pattern) => {
                if (typeof pattern !== "string" || pattern.trim() === "") {
                  return false;
                }
                const parts = pattern.split("*").map((p) => p.trim()).filter((p) => p.length > 0);
                if (parts.length === 0) {
                  return true;
                }
                let position = 0;
                for (const part of parts) {
                  const idx = absoluteUrl.indexOf(part, position);
                  if (idx === -1) {
                    return false;
                  }
                  position = idx + part.length;
                }
                return true;
              });
              if (!matchesFilter) {
                return;
              }
            }
            const isInternal = linkUrl.hostname === baseUrl.hostname;
            const linkType = isInternal ? "internal" : "external";
            const requestedTypes = context.linkTypes ?? ["all"];
            if (!requestedTypes.includes("all") && !requestedTypes.includes(linkType)) {
              return;
            }
            const isValidAbsolute = ValidationUtils.validateUrl(absoluteUrl);
            const safeHref = isValidAbsolute ? absoluteUrl : HtmlProcessor.sanitizeMarkdown(String(absoluteUrl));
            links.push({
              href: safeHref,
              text: context.includeAnchors !== false ? text : "",
              type: linkType,
              isValid: isValidAbsolute
            });
          } catch {
            const safeHref = HtmlProcessor.sanitizeMarkdown(String(href));
            links.push({
              href: safeHref,
              text: context.includeAnchors !== false ? text : "",
              type: "external",
              isValid: false
            });
          }
        }
      });
      const summary = {
        total: links.length,
        internal: links.filter((l) => l.type === "internal").length,
        external: links.filter((l) => l.type === "external").length,
        invalid: links.filter((l) => !l.isValid).length
      };
      linkSpan?.end({
        output: {
          linkCount: links.length,
          summary
        }
      });
      return linkExtractorOutputSchema.parse({
        url: scrapedUrl,
        links,
        summary
      });
    } catch (error) {
      const errorMessage = `Link extraction failed: ${error instanceof Error ? error.message : String(error)}`;
      logger$h.error(errorMessage);
      linkSpan?.end({ metadata: { error: errorMessage } });
      throw error;
    }
  }
});
const htmlToMarkdownOutputSchema = z.object({
  // Ensure we always pass a real string into the sanitizer to avoid any unencoded/ambiguous values.
  markdown: z.string().transform((s) => HtmlProcessor.sanitizeMarkdown(String(s))).describe("The converted markdown content (HTML-encoded to prevent XSS)."),
  savedFilePath: z.string().optional().describe("Path to the saved file if saveToFile was true.")
}).strict();
const htmlToMarkdownInputSchema = z.object({
  html: z.string().transform((s) => HtmlProcessor.sanitizeHtml(String(s))).describe("The HTML content to convert to markdown (will be sanitized by the schema to prevent raw HTML storage)."),
  saveToFile: z.boolean().optional().describe("Whether to save the markdown to a file."),
  fileName: z.string().optional().describe("Filename for the saved markdown (relative to data directory).")
}).strict();
const htmlToMarkdownTool = createTool({
  id: "html-to-markdown",
  description: "Convert HTML content to well-formatted markdown with enhanced JSDOM parsing and security.",
  inputSchema: htmlToMarkdownInputSchema,
  outputSchema: htmlToMarkdownOutputSchema,
  execute: async ({ context, tracingContext }) => {
    const convertSpan = tracingContext?.currentSpan?.createChildSpan({
      type: AISpanType.GENERIC,
      name: "html_to_markdown",
      input: {
        htmlLength: context.html.length,
        saveToFile: context.saveToFile,
        fileName: context.fileName
      }
    });
    logger$h.info("Converting HTML to markdown with enhanced JSDOM processing", {
      htmlLength: context.html.length,
      saveToFile: context.saveToFile
    });
    let savedFilePath;
    try {
      const sanitizedHtml = HtmlProcessor.sanitizeHtml(context.html);
      const markdown = HtmlProcessor.htmlToMarkdown(sanitizedHtml);
      if (context.saveToFile === true) {
        try {
          const providedName = context.fileName;
          const fileName = typeof providedName === "string" && providedName.trim().length > 0 ? ValidationUtils.sanitizeFileName(providedName) : `converted_${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}.md`;
          const dataDir = path.join(process.cwd(), "./data");
          const fullPath = path.join(dataDir, fileName);
          if (!ValidationUtils.validateFilePath(fullPath, dataDir)) {
            throw new ScrapingError("Invalid file path", "INVALID_FILE_PATH");
          }
          await fs$1.mkdir(dataDir, { recursive: true });
          const fileHandle = await fs$1.open(fullPath, "w");
          try {
            await fileHandle.writeFile(markdown, "utf-8");
          } finally {
            await fileHandle.close();
          }
          savedFilePath = path.relative(path.join(process.cwd(), "./data"), fullPath);
          logger$h.info("Markdown saved securely", { fileName: savedFilePath });
        } catch (error) {
          if (error instanceof ScrapingError) {
            throw error;
          }
          logger$h.error("Failed to save markdown file", { error: error instanceof Error ? error.message : String(error) });
        }
      }
      convertSpan?.end({
        output: {
          markdownLength: markdown.length,
          savedFile: typeof savedFilePath === "string" && savedFilePath.trim().length > 0
        }
      });
      return htmlToMarkdownOutputSchema.parse({
        markdown,
        savedFilePath
      });
    } catch (error) {
      const errorMessage = `HTML to markdown conversion failed: ${error instanceof Error ? error.message : String(error)}`;
      logger$h.error(errorMessage);
      convertSpan?.end({ metadata: { error: errorMessage } });
      throw error;
    }
  }
});
const listScrapedContentInputSchema = z.object({
  pattern: z.string().optional().describe("Pattern to filter files (e.g., '*.md', 'scraped_*')."),
  includeMetadata: z.boolean().optional().describe("Whether to include file metadata (default: true).")
});
const listScrapedContentOutputSchema = z.object({
  files: z.array(z.object({
    name: z.string(),
    path: z.string(),
    size: z.number().optional(),
    modified: z.string().optional(),
    created: z.string().optional()
  })).describe("Array of scraped content files."),
  totalFiles: z.number().describe("Total number of files found."),
  totalSize: z.number().describe("Total size of all files in bytes.")
});
createTool({
  id: "list-scraped-content",
  description: "List all scraped content files stored in the data directory with enhanced security.",
  inputSchema: listScrapedContentInputSchema,
  outputSchema: listScrapedContentOutputSchema,
  execute: async ({ context, tracingContext }) => {
    const listSpan = tracingContext?.currentSpan?.createChildSpan({
      type: AISpanType.GENERIC,
      name: "list_scraped_content",
      input: { pattern: context.pattern, includeMetadata: context.includeMetadata ?? true }
    });
    logger$h.info("Listing scraped content with security validation", { pattern: context.pattern });
    try {
      const dataDir = path.join(process.cwd(), "./data");
      try {
        await fs$1.access(dataDir);
      } catch {
        return listScrapedContentOutputSchema.parse({
          files: [],
          totalFiles: 0,
          totalSize: 0
        });
      }
      const items = await fs$1.readdir(dataDir, { withFileTypes: true });
      const files = [];
      let totalSize = 0;
      for (const item of items) {
        if (item.isFile()) {
          if (typeof context.pattern === "string" && context.pattern.trim() !== "") {
            try {
              const patternStr = context.pattern.trim();
              if (!/^[a-zA-Z0-9_\-.\\*\s]+$/.test(patternStr)) ; else {
                const matchWithWildcard = (name, pattern) => {
                  if (pattern === "*") {
                    return true;
                  }
                  const parts = pattern.split("*");
                  let pos = 0;
                  for (let i = 0; i < parts.length; i++) {
                    const part = parts[i];
                    if (part === "") {
                      continue;
                    }
                    const idx = name.indexOf(part, pos);
                    if (idx === -1) {
                      return false;
                    }
                    if (i === 0 && !pattern.startsWith("*") && idx !== 0) {
                      return false;
                    }
                    pos = idx + part.length;
                  }
                  if (!pattern.endsWith("*") && parts[parts.length - 1] !== "") {
                    const last = parts[parts.length - 1];
                    if (!name.endsWith(last)) {
                      return false;
                    }
                  }
                  return true;
                };
                if (!matchWithWildcard(item.name, patternStr)) {
                  continue;
                }
              }
            } catch {
            }
          }
          const filePath = path.join(dataDir, item.name);
          const relativePath = path.relative(dataDir, filePath);
          let metadata;
          if (context.includeMetadata !== false) {
            try {
              const stats = await fs$1.stat(filePath);
              metadata = {
                size: stats.size,
                modified: stats.mtime.toISOString(),
                created: stats.birthtime.toISOString()
              };
              totalSize += stats.size;
            } catch {
            }
          }
          files.push({
            name: item.name,
            path: relativePath,
            ...metadata
          });
        }
      }
      listSpan?.end({
        output: {
          totalFiles: files.length,
          totalSize
        }
      });
      return listScrapedContentOutputSchema.parse({
        files,
        totalFiles: files.length,
        totalSize
      });
    } catch (error) {
      const errorMessage = `Failed to list scraped content: ${error instanceof Error ? error.message : String(error)}`;
      logger$h.error(errorMessage);
      listSpan?.end({ metadata: { error: errorMessage } });
      throw error;
    }
  }
});
const contentCleanerInputSchema = z.object({
  html: z.string().describe("The HTML content to clean."),
  removeScripts: z.boolean().optional().describe("Remove script tags (default: true)."),
  removeStyles: z.boolean().optional().describe("Remove style tags (default: true)."),
  removeComments: z.boolean().optional().describe("Remove HTML comments (default: true)."),
  preserveStructure: z.boolean().optional().describe("Preserve document structure (default: true).")
});
const contentCleanerOutputSchema = z.object({
  cleanedHtml: z.string().describe("The cleaned HTML content."),
  originalSize: z.number().describe("Original HTML size in characters."),
  cleanedSize: z.number().describe("Cleaned HTML size in characters."),
  reductionPercent: z.number().describe("Percentage of content removed.")
});
const contentCleanerTool = createTool({
  id: "content-cleaner",
  description: "Clean HTML content by removing unwanted elements with enhanced JSDOM processing and security.",
  inputSchema: contentCleanerInputSchema,
  outputSchema: contentCleanerOutputSchema,
  execute: async ({ context, tracingContext }) => {
    const cleanSpan = tracingContext?.currentSpan?.createChildSpan({
      type: AISpanType.GENERIC,
      name: "content_cleaning",
      input: {
        htmlLength: context.html.length,
        removeScripts: context.removeScripts ?? true,
        removeStyles: context.removeStyles ?? true,
        removeComments: context.removeComments ?? true
      }
    });
    logger$h.info("Cleaning HTML content with enhanced JSDOM security", {
      originalLength: context.html.length,
      removeScripts: context.removeScripts ?? true,
      removeStyles: context.removeStyles ?? true
    });
    try {
      const dom = new JSDOM(context.html, {
        // Removed runScripts: 'dangerously' for safety
        includeNodeLocations: false
      });
      const { document } = dom.window;
      const originalSize = context.html.length;
      const dangerousElements = document.querySelectorAll('script, style, iframe, embed, object, noscript, meta, link[rel="stylesheet"], form, input, button, select, textarea');
      dangerousElements.forEach((element) => element.remove());
      const allElements = document.querySelectorAll("*");
      allElements.forEach((element) => {
        Array.from(element.attributes).forEach((attr) => {
          if (attr.name.startsWith("on") || HtmlProcessor.DANGEROUS_ATTRS.has(attr.name.toLowerCase())) {
            element.removeAttribute(attr.name);
          }
        });
      });
      if (context.removeComments !== false) {
        const removeComments = (node) => {
          const childNodes = Array.from(node.childNodes);
          childNodes.forEach((child) => {
            if (child.nodeType === dom.window.Node.COMMENT_NODE) {
              child.remove();
            } else if (child.nodeType === dom.window.Node.ELEMENT_NODE) {
              removeComments(child);
            }
          });
        };
        removeComments(document.body);
      }
      const cleanedHtml = context.preserveStructure !== false ? document.body.innerHTML : document.body.textContent ?? "";
      const cleanedSize = cleanedHtml.length;
      const reductionPercent = originalSize > 0 ? (originalSize - cleanedSize) / originalSize * 100 : 0;
      cleanSpan?.end({
        output: {
          originalSize,
          cleanedSize,
          reductionPercent: Math.round(reductionPercent * 100) / 100
        }
      });
      return contentCleanerOutputSchema.parse({
        cleanedHtml,
        originalSize,
        cleanedSize,
        reductionPercent: Math.round(reductionPercent * 100) / 100
      });
    } catch (error) {
      const errorMessage = `Content cleaning failed: ${error instanceof Error ? error.message : String(error)}`;
      logger$h.error(errorMessage);
      cleanSpan?.end({ metadata: { error: errorMessage } });
      throw error;
    }
  }
});

const logger$g = new PinoLogger({ level: "info" });
const exa = new Exa(process.env.EXA_API_KEY);
const webSearchTool = createTool({
  id: "web-search",
  description: "Search the web for information on a specific query and return summarized content",
  inputSchema: z.object({
    query: z.string().describe("The search query to run")
  }),
  execute: async ({ context, mastra }) => {
    logger$g.info("Executing web search tool");
    const { query } = context;
    try {
      const apiKey = process.env.EXA_API_KEY;
      if (apiKey === void 0 || apiKey === null || apiKey.trim() === "") {
        logger$g.error("Error: EXA_API_KEY not found in environment variables");
        return { results: [], error: "Missing API key" };
      }
      logger$g.info(`Searching web for: "${query}"`);
      const { results } = await exa.searchAndContents(query, {
        // Use fastest search type for optimal performance
        type: "fast",
        // Use 'never' for livecrawl to avoid slow live crawling (uses cached content)
        livecrawl: "never",
        // Limit text to what we actually use to reduce data transfer
        text: { maxCharacters: 8e3 },
        numResults: 3
      });
      if (!Array.isArray(results) || results.length === 0) {
        logger$g.info("No search results found");
        return { results: [], error: "No results found" };
      }
      logger$g.info(`Found ${results.length} search results, summarizing content...`);
      const summaryAgent = mastra.getAgent("webSummarizationAgent");
      const processedResults = [];
      for (const result of results) {
        try {
          if (!result.text || result.text.length < 100) {
            processedResults.push({
              title: result.title ?? "",
              url: result.url,
              content: result.text || "No content available"
            });
            continue;
          }
          const summaryResponse = await summaryAgent.generateVNext([
            {
              role: "user",
              content: `Please summarize the following web content for research query: "${query}"

Title: ${result.title ?? "No title"}
URL: ${result.url}
Content: ${result.text.substring(0, 8e3)}...

Provide a concise summary that captures the key information relevant to the research query.`
            }
          ]);
          processedResults.push({
            title: result.title ?? "",
            url: result.url,
            content: summaryResponse.text
          });
          logger$g.info(`Summarized content for: ${result.title ?? result.url}`);
        } catch (summaryError) {
          logger$g.error("Error summarizing content", {
            error: summaryError instanceof Error ? summaryError.message : String(summaryError),
            stack: summaryError instanceof Error ? summaryError.stack : void 0
          });
          processedResults.push({
            title: result.title ?? "",
            url: result.url,
            content: result.text ? result.text.substring(0, 500) + "..." : "Content unavailable"
          });
        }
      }
      return {
        results: processedResults
      };
    } catch (error) {
      logger$g.error("Error searching the web", { error });
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger$g.error("Error details:", { error: errorMessage });
      return {
        results: [],
        error: errorMessage
      };
    }
  }
});

const logger$f = new PinoLogger({ level: "info" });
logger$f.info("Initializing RAG Agent...");
const memory$8 = createResearchMemory();
const gemini = createGeminiProvider({
  authType: "oauth-personal",
  cacheDir: "~/.gemini/oauth_creds.json"
  // Directory to store cached tokens
});
const ragAgent = new Agent({
  id: "rag-agent",
  name: "RAG Agent",
  description: "An advanced RAG (Retrieval-Augmented Generation) Expert Agent for knowledge navigation and synthesis.",
  instructions: `You are an advanced RAG (Retrieval-Augmented Generation) Expert Agent, designed to serve as a comprehensive knowledge navigator and synthesizer. Your primary purpose is to assist users in efficiently accessing, understanding, and synthesizing information from a vast, dynamic knowledge base. Your core responsibility is to provide accurate, evidence-based, and well-structured answers by intelligently combining your inherent knowledge with information retrieved from external sources. You act as a trusted information specialist for users seeking detailed and reliable insights. Your capabilities include:

CORE CAPABILITIES:
1.  **Information Retrieval (Vector Search):** Utilize the 'vectorQueryTool' to perform highly relevant semantic searches across the stored knowledge base, identifying and extracting pertinent documents or data chunks.
2.  **Document Management (Processing & Indexing):** Employ the 'chunkerTool' to process new documents, breaking them down into manageable, searchable units and integrating them into the vector store for future retrieval.
3.  **Knowledge Synthesis & Reasoning:** Analyze retrieved information, identify key insights, resolve potential conflicts, and integrate this data with your foundational knowledge to construct coherent, comprehensive, and insightful responses.
4.  **Query Clarification:** Proactively engage with users to clarify ambiguous or underspecified queries, ensuring the retrieval and synthesis process is precisely aligned with their needs.
5.  **Source Attribution:** Accurately cite all retrieved sources to maintain transparency and allow users to verify information.

BEHAVIORAL GUIDELINES:
*   **Communication Style:** Maintain a professional, clear, and informative tone. Responses should be easy to understand, well-organized, and directly address the user's query.
*   **Decision-Making Framework:** Always prioritize retrieving information via 'vectorQueryTool' before formulating an answer. If direct retrieval is insufficient, leverage your internal knowledge to bridge gaps, clearly distinguishing between retrieved and generated content. If new documents are provided, use 'chunkerTool' to process them before attempting retrieval.
*   **Error Handling:** If a search yields no relevant results, clearly state this limitation and suggest alternative approaches or acknowledge the gap in the knowledge base. If a query is unanswerable, explain why.
*   **Transparency:** Explicitly state when information is directly retrieved from the knowledge base versus when it is synthesized or inferred from your general training data. Always provide citations for retrieved information.
*   **Proactive Engagement:** If a query is vague or could benefit from additional context, ask clarifying questions to refine the search and improve the quality of the response.

CONSTRAINTS & BOUNDARIES:
*   **Tool Usage:** You are strictly limited to using 'vectorQueryTool' for information retrieval and 'chunkerTool' for document processing. Do not attempt to access external websites or databases directly.
*   **Scope:** Your primary function is information retrieval and synthesis from the provided knowledge base. Do not engage in creative writing, personal opinions, or tasks unrelated to information provision.
*   **Data Privacy:** Handle all information with the utmost confidentiality. Do not store personal user data or share sensitive information beyond the scope of the current interaction.
*   **Ethical Conduct:** Ensure all responses are unbiased, factual, and avoid generating harmful, discriminatory, or misleading content.

SUCCESS CRITERIA:
*   **Accuracy:** Responses must be factually correct and well-supported by evidence from the knowledge base.
*   **Relevance:** Retrieved and synthesized information must directly address the user's query.
*   **Completeness:** Provide comprehensive answers that cover all aspects of the query, acknowledging any limitations or gaps.
*   **Clarity & Structure:** Responses are well-organized, easy to read, and include clear headings, bullet points, and source citations where appropriate.
*   **Efficiency:** Deliver timely and concise responses without unnecessary verbosity.
*   **User Satisfaction:** The ultimate measure of success is the user's ability to gain valuable insights and have their information needs met effectively.

Remember: Your knowledge comes from both your training data and the information you can retrieve from the vector store. Always leverage both for comprehensive answers, prioritizing retrieved information.
${LIBSQL_PROMPT}
`,
  evals: {
    contentSimilarity: new ContentSimilarityMetric({ ignoreCase: true, ignoreWhitespace: true }),
    completeness: new CompletenessMetric(),
    textualDifference: new TextualDifferenceMetric(),
    keywordCoverage: new KeywordCoverageMetric(),
    // Keywords will be provided at runtime for evaluation
    toneConsistency: new ToneConsistencyMetric()
  },
  model: gemini("gemini-2.5-flash"),
  tools: {
    //    vectorQueryTool,
    //    chunkerTool,
    batchWebScraperTool,
    siteMapExtractorTool,
    linkExtractorTool,
    htmlToMarkdownTool,
    contentCleanerTool,
    readDataFileTool,
    writeDataFileTool,
    deleteDataFileTool,
    listDataDirTool,
    evaluateResultTool,
    extractLearningsTool,
    graphRAGUpsertTool,
    graphRAGTool,
    graphRAGQueryTool,
    //    rerankTool,
    weatherTool,
    webScraperTool,
    webSearchTool
  },
  memory: memory$8
});

const logger$e = new PinoLogger({ level: "info" });
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
const conductWebResearchStep = createStep({
  id: "conduct-web-research",
  inputSchema: z.object({
    query: z.string()
  }),
  outputSchema: z.object({
    searchResults: z.array(z.object({
      title: z.string(),
      url: z.string(),
      content: z.string()
    })),
    learnings: z.array(z.object({
      learning: z.string(),
      followUpQuestions: z.array(z.string()),
      source: z.string()
    })),
    completedQueries: z.array(z.string())
  }),
  execute: async ({ inputData }) => {
    const { query } = inputData;
    logger$e.info(`Starting web research for query: ${query}`);
    try {
      const result = await researchAgent.generateVNext(
        [
          {
            role: "user",
            content: `Research the following topic thoroughly using the two-phase process: "${query}".
            Phase 1: Search for 2-3 initial queries about this topic
            Phase 2: Search for follow-up questions from the learnings (then STOP)
            Return findings in JSON format with queries, searchResults, learnings, completedQueries, and phase.`
          }
        ],
        {
          output: z.object({
            queries: z.array(z.string()),
            searchResults: z.array(
              z.object({
                title: z.string(),
                url: z.string(),
                relevance: z.string().optional(),
                content: z.string()
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
      if (!result.object) {
        logger$e.warn(`researchAgent.generate did not return an object for query: ${query}`);
        return {
          searchResults: [],
          learnings: [],
          completedQueries: []
        };
      }
      logger$e.info(`Web research completed for query: ${query}`);
      return {
        searchResults: result.object.searchResults,
        learnings: result.object.learnings,
        completedQueries: result.object.completedQueries
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error && error.stack !== null ? error.stack : void 0;
      logger$e.error("Error in conductWebResearchStep", { error: errMsg, stack: errStack });
      return {
        searchResults: [],
        learnings: [],
        completedQueries: []
      };
    }
  }
});
const evaluateAndExtractStep = createStep({
  id: "evaluate-and-extract",
  inputSchema: z.object({
    query: z.string(),
    searchResult: z.object({
      title: z.string(),
      url: z.string(),
      content: z.string()
    })
  }),
  outputSchema: z.object({
    isRelevant: z.boolean(),
    reason: z.string(),
    learning: z.string().optional(),
    followUpQuestions: z.array(z.string()).optional(),
    processedUrl: z.string()
  }),
  execute: async ({ inputData }) => {
    const { query, searchResult } = inputData;
    logger$e.info(`Evaluating and extracting from search result: ${searchResult.url}`);
    try {
      const evaluationResult = await evaluationAgent.generateVNext(
        [
          {
            role: "user",
            content: `Evaluate whether this search result is relevant to the query: "${query}".
            Search result: Title: ${searchResult.title}, URL: ${searchResult.url}, Content snippet: ${searchResult.content.substring(0, 500)}...
            Respond with JSON { isRelevant: boolean, reason: string }`
          }
        ],
        {
          output: z.object({
            isRelevant: z.boolean(),
            reason: z.string()
          })
        }
      );
      if (!evaluationResult.object) {
        logger$e.warn(`evaluationAgent.generate did not return an object for search result: ${searchResult.url}`);
        return {
          isRelevant: false,
          reason: "Evaluation agent did not return a valid object.",
          processedUrl: searchResult.url
        };
      }
      if (!evaluationResult.object.isRelevant) {
        logger$e.info(`Search result not relevant: ${searchResult.url}`);
        return {
          isRelevant: false,
          reason: evaluationResult.object.reason,
          processedUrl: searchResult.url
        };
      }
      const extractionResult = await learningExtractionAgent.generateVNext(
        [
          {
            role: "user",
            content: `The user is researching "${query}". Extract a key learning and generate up to 1 follow-up question from this search result:
            Title: ${searchResult.title}, URL: ${searchResult.url}, Content: ${searchResult.content.substring(0, 1500)}...
            Respond with JSON { learning: string, followUpQuestions: string[] }`
          }
        ],
        {
          output: z.object({
            learning: z.string(),
            followUpQuestions: z.array(z.string()).max(1)
          })
        }
      );
      if (!extractionResult.object) {
        logger$e.warn(`learningExtractionAgent.generate did not return an object for search result: ${searchResult.url}`);
        return {
          isRelevant: true,
          reason: "Extraction agent did not return a valid object.",
          learning: void 0,
          followUpQuestions: void 0,
          processedUrl: searchResult.url
        };
      }
      logger$e.info(`Extracted learning from: ${searchResult.url}`);
      return {
        isRelevant: true,
        reason: evaluationResult.object.reason,
        learning: extractionResult.object.learning,
        followUpQuestions: extractionResult.object.followUpQuestions,
        processedUrl: searchResult.url
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error && error.stack !== null ? error.stack : void 0;
      logger$e.error("Error in evaluateAndExtractStep", { error: errMsg, stack: errStack });
      return {
        isRelevant: false,
        reason: `Error during evaluation or extraction: ${errMsg}`,
        processedUrl: searchResult.url
      };
    }
  }
});
const consolidateResearchDataStep = createStep({
  id: "consolidate-research-data",
  inputSchema: z.object({
    allLearnings: z.array(z.object({
      learning: z.string(),
      followUpQuestions: z.array(z.string()),
      source: z.string()
    })),
    allRelevantContent: z.array(z.object({
      title: z.string(),
      url: z.string(),
      content: z.string()
    })),
    originalQuery: z.string()
  }),
  outputSchema: z.object({
    consolidatedText: z.string(),
    allFollowUpQuestions: z.array(z.string()),
    originalQuery: z.string()
  }),
  execute: async ({ inputData }) => {
    const { allLearnings, allRelevantContent, originalQuery } = inputData;
    logger$e.info("Consolidating research data.");
    const combinedLearnings = allLearnings.map((l) => l.learning).join("\n\n");
    const combinedContent = allRelevantContent.map((c) => `Title: ${c.title}
URL: ${c.url}
Content: ${c.content}`).join("\n\n---\n\n");
    const allFollowUpQuestions = allLearnings.flatMap((l) => l.followUpQuestions);
    const consolidatedText = `Original Query: ${originalQuery}

Learnings:
${combinedLearnings}

Relevant Content:
${combinedContent}`;
    logger$e.info("Research data consolidated.");
    return {
      consolidatedText,
      allFollowUpQuestions,
      originalQuery
    };
  }
});
const processAndRetrieveStep = createStep({
  id: "process-and-retrieve",
  inputSchema: z.object({
    consolidatedText: z.string(),
    originalQuery: z.string()
  }),
  outputSchema: z.object({
    refinedContext: z.string()
  }),
  execute: async ({ inputData, runtimeContext, tracingContext }) => {
    const { consolidatedText, originalQuery } = inputData;
    logger$e.info("Starting RAG processing and retrieval.");
    try {
      const chunkingResult = await ragAgent.tools.graphRAGUpsertTool.execute({
        input: {
          document: {
            text: consolidatedText,
            type: "text",
            metadata: {}
          },
          indexName: "comprehensive_research_data",
          createIndex: true,
          vectorProfile: "libsql"
        },
        context: {
          document: {
            text: "",
            type: "text",
            metadata: {}
          },
          indexName: "",
          createIndex: false,
          vectorProfile: "libsql"
        },
        runtimeContext,
        tracingContext
      });
      logger$e.info(`Chunked and upserted ${chunkingResult.chunkIds.length} chunks to comprehensive_research_data index.`);
      const rerankedResults = await ragAgent.tools.graphRAGQueryTool.execute({
        input: {
          query: originalQuery,
          topK: 10,
          threshold: 0.5,
          indexName: "comprehensive_research_data",
          vectorProfile: "libsql",
          includeVector: false,
          minScore: 0
        },
        context: {
          query: "",
          topK: 0,
          threshold: 0,
          indexName: "",
          vectorProfile: "libsql",
          includeVector: false,
          minScore: 0
        },
        runtimeContext,
        tracingContext
      });
      const refinedContext = rerankedResults.sources.map((s) => s.content).join("\n\n");
      logger$e.info("RAG processing and retrieval complete.");
      return {
        refinedContext
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error && error.stack !== null ? error.stack : void 0;
      logger$e.error("Error in processAndRetrieveStep:", { error: errMsg, stack: errStack });
      return {
        refinedContext: `Error during RAG processing: ${errMsg}`
      };
    }
  }
});
const synthesizeFinalContentStep = createStep({
  id: "synthesize-final-content",
  inputSchema: z.object({
    refinedContext: z.string(),
    originalQuery: z.string()
  }),
  outputSchema: z.object({
    finalSynthesizedContent: z.string()
  }),
  execute: async ({ inputData }) => {
    const { refinedContext, originalQuery } = inputData;
    logger$e.info("Synthesizing final content.");
    try {
      const summaryResponse = await webSummarizationAgent.generate([
        {
          role: "user",
          content: `Synthesize the following refined context into a comprehensive and coherent summary, directly addressing the original query: "${originalQuery}".
          Refined Context: ${refinedContext}`
        }
      ]);
      logger$e.info("Final content synthesized.");
      return {
        finalSynthesizedContent: summaryResponse.text
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error && error.stack !== null ? error.stack : void 0;
      logger$e.error("Error in synthesizeFinalContentStep:", { error: errMsg, stack: errStack });
      return {
        finalSynthesizedContent: `Error during content synthesis: ${errMsg}`
      };
    }
  }
});
const generateFinalReportStep = createStep({
  id: "generate-final-report",
  inputSchema: z.object({
    finalSynthesizedContent: z.string(),
    originalQuery: z.string()
  }),
  outputSchema: z.object({
    report: z.string()
  }),
  execute: async ({ inputData }) => {
    const { finalSynthesizedContent, originalQuery } = inputData;
    logger$e.info("Generating final report.");
    try {
      const report = await reportAgent.generate([
        {
          role: "user",
          content: `Generate a comprehensive report based on the following synthesized content, addressing the original research query: "${originalQuery}".
          Content: ${finalSynthesizedContent}`
        }
      ]);
      logger$e.info("Final report generated.");
      return { report: report.text };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return { report: `Error generating report: ${errMsg}` };
    }
  }
});
const reportApprovalStep = createStep({
  id: "report-approval",
  inputSchema: z.object({
    report: z.string()
  }),
  outputSchema: z.object({
    approved: z.boolean(),
    finalReport: z.string()
  }),
  resumeSchema: z.object({
    approved: z.boolean()
  }),
  suspendSchema: z.object({
    message: z.string(),
    reportPreview: z.string()
  }),
  execute: async ({ inputData, resumeData, suspend }) => {
    const { report } = inputData;
    const { approved } = resumeData ?? {};
    if (approved === void 0) {
      logger$e.info("Suspending for report approval.");
      await suspend({
        message: "Review the generated report. Do you approve it? (true/false)",
        reportPreview: report.substring(0, 1e3) + "..."
      });
      return { approved: false, finalReport: report };
    }
    logger$e.info(`Report approval received: ${approved}`);
    return {
      approved,
      finalReport: report
    };
  }
});
let _currentIterationCount;
const iterativeResearchLoopWorkflow = createWorkflow({
  id: "iterative-research-loop",
  inputSchema: z.object({
    query: z.string(),
    iterationCount: z.number().optional(),
    allLearnings: z.array(z.any()).optional(),
    allRelevantContent: z.array(z.any()).optional(),
    currentFollowUpQuestions: z.array(z.string()).optional()
  }),
  outputSchema: z.object({
    allLearnings: z.array(z.any()),
    allRelevantContent: z.array(z.any()),
    newFollowUpQuestions: z.array(z.string()),
    iterationCount: z.number()
  }),
  steps: [conductWebResearchStep, evaluateAndExtractStep]
}).map(async ({ inputData }) => {
  const { query, iterationCount = 0, allLearnings = [], allRelevantContent = [], currentFollowUpQuestions = [] } = inputData;
  const newIterationCount = iterationCount + 1;
  _currentIterationCount = newIterationCount;
  const researchQuery = newIterationCount > 1 && currentFollowUpQuestions.length > 0 ? currentFollowUpQuestions.join(" OR ") : query;
  logger$e.info(`Starting iterative research iteration ${newIterationCount} with query: ${researchQuery}`);
  return {
    query: researchQuery,
    allLearnings,
    allRelevantContent,
    iterationCount: newIterationCount,
    currentFollowUpQuestions
  };
}).then(conductWebResearchStep).map(async ({ inputData }) => {
  return inputData.searchResults;
}).foreach(evaluateAndExtractStep, { concurrency: 1 }).map(async ({ getStepResult }) => {
  const iterationLearnings = getStepResult(conductWebResearchStep).learnings;
  const iterationSearchResults = getStepResult(conductWebResearchStep).searchResults;
  const _rawEvaluateResults = getStepResult(evaluateAndExtractStep);
  const evaluateResults = Array.isArray(_rawEvaluateResults) ? _rawEvaluateResults : [_rawEvaluateResults];
  const relevantLearnings = [];
  const relevantContent = [];
  const newFollowUpQuestions = [];
  for (const evalResult of evaluateResults) {
    const processedUrl = typeof evalResult.processedUrl === "string" ? evalResult.processedUrl.trim() : "";
    if (evalResult.isRelevant && processedUrl !== "") {
      const originalSearchResult = iterationSearchResults.find((sr) => sr.url === processedUrl);
      const hasValidTitle = typeof originalSearchResult?.title === "string" && originalSearchResult.title.trim() !== "";
      const hasValidUrl = typeof originalSearchResult?.url === "string" && originalSearchResult.url.trim() !== "";
      const hasValidContent = typeof originalSearchResult?.content === "string" && originalSearchResult.content.trim() !== "";
      if (hasValidTitle && hasValidUrl && hasValidContent) {
        const sr = originalSearchResult;
        relevantContent.push({
          title: sr.title,
          url: sr.url,
          content: sr.content
        });
      }
      const originalLearning = iterationLearnings.find((l) => l.source === processedUrl);
      if (originalLearning) {
        relevantLearnings.push(originalLearning);
        newFollowUpQuestions.push(...originalLearning.followUpQuestions ?? []);
      }
    }
  }
  return {
    allLearnings: relevantLearnings,
    allRelevantContent: relevantContent,
    newFollowUpQuestions,
    iterationCount: _currentIterationCount
  };
}).commit();
const comprehensiveResearchWorkflow = createWorkflow({
  id: "comprehensive-research-workflow",
  inputSchema: z.object({}),
  outputSchema: z.object({
    finalReport: z.string(),
    approved: z.boolean()
  }),
  steps: [
    getUserQueryStep,
    iterativeResearchLoopWorkflow,
    consolidateResearchDataStep,
    processAndRetrieveStep,
    synthesizeFinalContentStep,
    generateFinalReportStep,
    reportApprovalStep
  ]
});
comprehensiveResearchWorkflow.then(getUserQueryStep).dowhile(
  iterativeResearchLoopWorkflow,
  async ({ inputData }) => {
    const MAX_ITERATIONS = 7;
    const hasNewFollowUpQuestions = Array.isArray(inputData.newFollowUpQuestions) && inputData.newFollowUpQuestions.length > 0;
    const notMaxIterations = inputData.iterationCount < MAX_ITERATIONS;
    logger$e.debug(`Loop condition check: hasNewFollowUpQuestions=${hasNewFollowUpQuestions}, notMaxIterations=${notMaxIterations}`);
    return hasNewFollowUpQuestions && notMaxIterations;
  }
).map(async ({ getStepResult }) => {
  const overallLearnings = getStepResult(iterativeResearchLoopWorkflow).allLearnings;
  const overallRelevantContent = getStepResult(iterativeResearchLoopWorkflow).allRelevantContent;
  const originalQuery = getStepResult(getUserQueryStep).query;
  return {
    allLearnings: overallLearnings,
    allRelevantContent: overallRelevantContent,
    originalQuery
  };
}).then(consolidateResearchDataStep).map(async ({ inputData }) => {
  const { consolidatedText, originalQuery } = inputData;
  return {
    consolidatedText,
    originalQuery
  };
}).then(processAndRetrieveStep).map(async ({ inputData, getStepResult }) => {
  const { refinedContext } = inputData;
  const originalQuery = getStepResult(getUserQueryStep).query;
  return {
    refinedContext,
    originalQuery
  };
}).then(synthesizeFinalContentStep).map(async ({ inputData, getStepResult }) => {
  const { finalSynthesizedContent } = inputData;
  const originalQuery = getStepResult(getUserQueryStep).query;
  return {
    finalSynthesizedContent,
    originalQuery
  };
}).then(generateFinalReportStep).map(async ({ inputData }) => {
  const { report } = inputData;
  return {
    report
  };
}).then(reportApprovalStep).commit();

const logger$d = new PinoLogger({
  level: "info"
});
logger$d.info("Initializing OpenRouter Assistant Agent...");
const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY
});
const assistant = new Agent({
  id: "assistant",
  name: "assistant",
  description: "A helpful assistant.",
  instructions: `You are a helpful assistant. Today is ${(/* @__PURE__ */ new Date()).toISOString()}. Please provide a concise and accurate response.
    Your goal is to help the user with their research tasks or anything else they need.
    `,
  model: openrouter(
    "openrouter/sonoma-sky-alpha",
    {
      extraBody: {
        reasoning: {
          max_tokens: 6144
        }
      }
    }
  ),
  // memory: memory, // Using LibSQL memory instead of PostgreSQL
  evals: {
    contentSimilarity: new ContentSimilarityMetric({ ignoreCase: true, ignoreWhitespace: true }),
    completeness: new CompletenessMetric(),
    textualDifference: new TextualDifferenceMetric(),
    keywordCoverage: new KeywordCoverageMetric(),
    // Keywords will be provided at runtime for evaluation
    toneConsistency: new ToneConsistencyMetric()
  },
  tools: {
    // Corrected indentation for the 'tools' object
    readDataFileTool,
    writeDataFileTool,
    deleteDataFileTool,
    listDataDirTool,
    evaluateResultTool,
    extractLearningsTool,
    batchWebScraperTool,
    siteMapExtractorTool,
    linkExtractorTool,
    htmlToMarkdownTool,
    contentCleanerTool,
    //vectorQueryTool,
    //chunkerTool,
    //graphRAGUpsertTool,
    //graphRAGTool,
    //graphRAGQueryTool,
    //rerankTool,
    //weatherTool,
    webScraperTool
    //webSearchTool,
  },
  inputProcessors: [
    new UnicodeNormalizer({
      stripControlChars: true,
      collapseWhitespace: true,
      preserveEmojis: true,
      trim: true
    })
  ],
  outputProcessors: [
    new BatchPartsProcessor({
      batchSize: 10,
      // Maximum parts to batch together
      maxWaitTime: 50,
      // Maximum time to wait before emitting (ms)
      emitOnNonText: true
      // Emit immediately on non-text parts
    })
  ]
});
logger$d.info("OpenRouter Assistant Agent Working...");

const logger$c = new PinoLogger({ level: "info" });
logger$c.info("Complex Research Network initialized");
const memory$7 = createResearchMemory();
const complexResearchNetwork = new NewAgentNetwork({
  id: "complex-research-network",
  name: "Complex Research Network",
  instructions: `You are an advanced research and reporting network. Your goal is to thoroughly understand and respond to user queries by leveraging specialized agents and workflows.

  **Capabilities:**
  - **Information Retrieval (RAG Agent)**: Use the 'ragAgent' to perform vector-based searches and retrieve relevant information from a knowledge base.
  - **In-depth Research (Research Agent)**: Use the 'researchAgent' to conduct multi-phase web research, including initial and follow-up searches, and extract key learnings.
  - **Report Generation (Report Agent)**: Use the 'reportAgent' to synthesize research data into comprehensive, well-structured reports.
  - **Automated Research Workflow**: Use 'researchWorkflow' to guide users through a structured research process, including query definition and approval.
  - **Automated Report Generation Workflow**: Use 'generateReportWorkflow' to manage the end-to-end process of researching and generating a report, including user approval steps.

  **Decision-Making Guidelines:**
  - When the user asks for a specific search or retrieval from existing knowledge, prioritize 'ragAgent'.
  - When the user asks for in-depth investigation or web-based research, consider 'researchAgent' or 'researchWorkflow'. Use 'researchWorkflow' if the task requires user interaction (e.g., approval of research scope).
  - When the user asks for a comprehensive document or summary based on provided or gathered information, prioritize 'reportAgent' or 'generateReportWorkflow'. Use 'generateReportWorkflow' for a full end-to-end report creation process with potential user approvals.
  - Always aim to provide the most complete and accurate response possible by combining the strengths of your specialized components.
  - If a task involves multiple stages (e.g., research then report), consider which workflow (e.g., 'generateReportWorkflow') can handle the entire sequence.
  `,
  model: google("gemini-2.5-flash-lite"),
  agents: {
    ragAgent,
    researchAgent,
    reportAgent,
    assistant
  },
  workflows: {
    researchWorkflow,
    generateReportWorkflow
  },
  memory: memory$7
});

new PinoLogger({ level: "info" });
const octokit = new Octokit({ auth: process.env.GITHUB_API_KEY });

const logger$b = new PinoLogger({ name: "GitHubSearch", level: "info" });
const searchCodeOutputSchema = z.object({
  status: z.enum(["success", "error"]),
  data: z.object({
    total_count: z.number(),
    incomplete_results: z.boolean(),
    items: z.array(z.object({
      name: z.string(),
      path: z.string(),
      sha: z.string(),
      url: z.string().url(),
      html_url: z.string().url()
    }))
  }).optional(),
  errorMessage: z.string().optional().describe("Error searching code")
}).strict();
const searchCode = createTool$1({
  id: "searchCode",
  description: "Searches code.",
  inputSchema: z.object({
    q: z.string()
  }),
  outputSchema: searchCodeOutputSchema,
  execute: async ({ context, tracingContext }) => {
    logger$b.info(`Searching code with query: ${context.q}`);
    const searchSpan = tracingContext?.currentSpan?.createChildSpan({
      type: AISpanType.GENERIC,
      name: "search_code",
      input: { query: context.q }
    });
    try {
      const result = await octokit.search.code(context);
      searchSpan?.end({ output: { total_count: result.data.total_count } });
      logger$b.info(`Found ${result.data.total_count} code search results`);
      return searchCodeOutputSchema.parse({ status: "success", data: result.data });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      searchSpan?.end({ metadata: { error: errorMessage } });
      logger$b.error(`Failed to search code: ${errorMessage}`);
      return searchCodeOutputSchema.parse({ status: "error", data: null, errorMessage });
    }
  }
});
const searchIssuesAndPullRequestsOutputSchema = z.object({
  status: z.enum(["success", "error"]),
  data: z.object({
    total_count: z.number(),
    incomplete_results: z.boolean(),
    items: z.array(z.object({
      id: z.number(),
      number: z.number(),
      title: z.string(),
      state: z.string(),
      html_url: z.string().url()
    }))
  }).optional(),
  errorMessage: z.string().optional().describe("Error searching issues and pull requests")
}).strict();
const searchIssuesAndPullRequests = createTool$1({
  id: "searchIssuesAndPullRequests",
  description: "Searches issues and pull requests.",
  inputSchema: z.object({
    q: z.string()
  }),
  outputSchema: searchIssuesAndPullRequestsOutputSchema,
  execute: async ({ context, tracingContext }) => {
    logger$b.info(`Searching issues and pull requests with query: ${context.q}`);
    const searchSpan = tracingContext?.currentSpan?.createChildSpan({
      type: AISpanType.GENERIC,
      name: "search_issues_prs",
      input: { query: context.q }
    });
    try {
      const result = await octokit.search.issuesAndPullRequests(context);
      searchSpan?.end({ output: { total_count: result.data.total_count } });
      logger$b.info(`Found ${result.data.total_count} issues/PR search results`);
      return searchIssuesAndPullRequestsOutputSchema.parse({ status: "success", data: result.data });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      searchSpan?.end({ metadata: { error: errorMessage } });
      logger$b.error(`Failed to search issues/PRs: ${errorMessage}`);
      return searchIssuesAndPullRequestsOutputSchema.parse({ status: "error", data: null, errorMessage });
    }
  }
});
const searchRepositoriesOutputSchema = z.object({
  status: z.enum(["success", "error"]),
  data: z.object({
    total_count: z.number(),
    incomplete_results: z.boolean(),
    items: z.array(z.object({
      id: z.number(),
      name: z.string(),
      full_name: z.string(),
      html_url: z.string().url()
    }))
  }).optional(),
  errorMessage: z.string().optional().describe("Error searching repositories")
}).strict();
const searchRepositories = createTool$1({
  id: "searchRepositories",
  description: "Searches repositories.",
  inputSchema: z.object({
    q: z.string()
  }),
  outputSchema: searchRepositoriesOutputSchema,
  execute: async ({ context, tracingContext }) => {
    logger$b.info(`Searching repositories with query: ${context.q}`);
    const searchSpan = tracingContext?.currentSpan?.createChildSpan({
      type: AISpanType.GENERIC,
      name: "search_repositories",
      input: { query: context.q }
    });
    try {
      const result = await octokit.search.repos(context);
      searchSpan?.end({ output: { total_count: result.data.total_count } });
      logger$b.info(`Found ${result.data.total_count} repository search results`);
      return searchRepositoriesOutputSchema.parse({ status: "success", data: result.data });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      searchSpan?.end({ metadata: { error: errorMessage } });
      logger$b.error(`Failed to search repositories: ${errorMessage}`);
      return searchRepositoriesOutputSchema.parse({ status: "error", data: null, errorMessage });
    }
  }
});
const searchUsersOutputSchema = z.object({
  status: z.enum(["success", "error"]),
  data: z.object({
    total_count: z.number(),
    incomplete_results: z.boolean(),
    items: z.array(z.object({
      login: z.string(),
      id: z.number(),
      avatar_url: z.string().url(),
      html_url: z.string().url()
    }))
  }).optional(),
  errorMessage: z.string().optional().describe("Error searching users")
}).strict();
const searchUsers = createTool$1({
  id: "searchUsers",
  description: "Searches users.",
  inputSchema: z.object({
    q: z.string()
  }),
  outputSchema: searchUsersOutputSchema,
  execute: async ({ context, tracingContext }) => {
    logger$b.info(`Searching users with query: ${context.q}`);
    const searchSpan = tracingContext?.currentSpan?.createChildSpan({
      type: AISpanType.GENERIC,
      name: "search_users",
      input: { query: context.q }
    });
    try {
      const result = await octokit.search.users(context);
      searchSpan?.end({ output: { total_count: result.data.total_count } });
      logger$b.info(`Found ${result.data.total_count} user search results`);
      return searchUsersOutputSchema.parse({ status: "success", data: result.data });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      searchSpan?.end({ metadata: { error: errorMessage } });
      logger$b.error(`Failed to search users: ${errorMessage}`);
      return searchUsersOutputSchema.parse({ status: "error", data: null, errorMessage });
    }
  }
});

const logger$a = new PinoLogger({ name: "GitHubPullRequests", level: "info" });
const PullRequestUserSchema = z.object({
  login: z.string(),
  id: z.number(),
  node_id: z.string(),
  avatar_url: z.string().url(),
  gravatar_id: z.string().optional(),
  url: z.string().url(),
  html_url: z.string().url(),
  followers_url: z.string().url(),
  following_url: z.string().url(),
  gists_url: z.string().url(),
  starred_url: z.string().url(),
  subscriptions_url: z.string().url(),
  organizations_url: z.string().url(),
  repos_url: z.string().url(),
  events_url: z.string().url(),
  received_events_url: z.string().url(),
  type: z.enum(["User", "Organization"]),
  site_admin: z.boolean()
});
const PullRequestLabelSchema = z.object({
  id: z.number(),
  node_id: z.string(),
  url: z.string().url(),
  name: z.string(),
  description: z.string().nullable(),
  color: z.string(),
  default: z.boolean()
});
const PullRequestMilestoneSchema = z.object({
  url: z.string().url(),
  html_url: z.string().url(),
  labels_url: z.string().url(),
  id: z.number(),
  node_id: z.string(),
  number: z.number(),
  state: z.enum(["open", "closed"]),
  title: z.string(),
  description: z.string().nullable(),
  creator: PullRequestUserSchema.nullable(),
  open_issues: z.number(),
  closed_issues: z.number(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  closed_at: z.string().datetime().nullable(),
  due_on: z.string().datetime().nullable()
});
const PullRequestSchema = z.object({
  id: z.number(),
  node_id: z.string(),
  url: z.string().url(),
  html_url: z.string().url(),
  diff_url: z.string().url(),
  patch_url: z.string().url(),
  issue_url: z.string().url(),
  commits_url: z.string().url(),
  review_comments_url: z.string().url(),
  review_comment_url: z.string().url(),
  comments_url: z.string().url(),
  statuses_url: z.string().url(),
  number: z.number(),
  state: z.enum(["open", "closed"]),
  locked: z.boolean(),
  title: z.string(),
  user: PullRequestUserSchema,
  body: z.string().nullable(),
  labels: z.array(PullRequestLabelSchema),
  milestone: PullRequestMilestoneSchema.nullable(),
  active_lock_reason: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  closed_at: z.string().datetime().nullable(),
  merged_at: z.string().datetime().nullable(),
  merge_commit_sha: z.string().nullable(),
  assignee: PullRequestUserSchema.nullable(),
  assignees: z.array(PullRequestUserSchema),
  requested_reviewers: z.array(PullRequestUserSchema),
  requested_teams: z.array(z.object({
    id: z.number(),
    node_id: z.string(),
    url: z.string().url(),
    html_url: z.string().url(),
    name: z.string(),
    slug: z.string(),
    description: z.string().nullable(),
    privacy: z.enum(["open", "closed", "secret"]),
    permission: z.string(),
    members_url: z.string().url(),
    repositories_url: z.string().url(),
    parent: z.record(z.any()).nullable()
  })),
  head: z.object({
    label: z.string(),
    ref: z.string(),
    sha: z.string(),
    user: PullRequestUserSchema,
    repo: z.object({
      id: z.number(),
      node_id: z.string(),
      name: z.string(),
      full_name: z.string(),
      private: z.boolean(),
      owner: PullRequestUserSchema,
      html_url: z.string().url(),
      description: z.string().nullable(),
      fork: z.boolean(),
      url: z.string().url(),
      archive_url: z.string().url(),
      assignees_url: z.string().url(),
      blobs_url: z.string().url(),
      branches_url: z.string().url(),
      collaborators_url: z.string().url(),
      comments_url: z.string().url(),
      commits_url: z.string().url(),
      compare_url: z.string().url(),
      contents_url: z.string().url(),
      contributors_url: z.string().url(),
      deployments_url: z.string().url(),
      downloads_url: z.string().url(),
      events_url: z.string().url(),
      forks_url: z.string().url(),
      git_commits_url: z.string().url(),
      git_refs_url: z.string().url(),
      git_tags_url: z.string().url(),
      git_url: z.string().url(),
      issue_comment_url: z.string().url(),
      issue_events_url: z.string().url(),
      issues_url: z.string().url(),
      keys_url: z.string().url(),
      labels_url: z.string().url(),
      languages_url: z.string().url(),
      merges_url: z.string().url(),
      milestones_url: z.string().url(),
      notifications_url: z.string().url(),
      pulls_url: z.string().url(),
      releases_url: z.string().url(),
      ssh_url: z.string(),
      stargazers_url: z.string().url(),
      statuses_url: z.string().url(),
      subscribers_url: z.string().url(),
      subscription_url: z.string().url(),
      tags_url: z.string().url(),
      teams_url: z.string().url(),
      trees_url: z.string().url(),
      clone_url: z.string().url(),
      mirror_url: z.string().url().nullable(),
      hooks_url: z.string().url(),
      svn_url: z.string().url(),
      homepage: z.string().nullable(),
      language: z.string().nullable(),
      forks_count: z.number(),
      stargazers_count: z.number(),
      watchers_count: z.number(),
      size: z.number(),
      default_branch: z.string(),
      open_issues_count: z.number(),
      is_template: z.boolean().optional(),
      topics: z.array(z.string()).optional(),
      has_issues: z.boolean(),
      has_projects: z.boolean(),
      has_wiki: z.boolean(),
      has_pages: z.boolean(),
      has_downloads: z.boolean(),
      archived: z.boolean(),
      disabled: z.boolean(),
      visibility: z.enum(["public", "private"]).optional(),
      pushed_at: z.string().datetime().nullable(),
      created_at: z.string().datetime(),
      updated_at: z.string().datetime(),
      permissions: z.object({
        admin: z.boolean(),
        maintain: z.boolean().optional(),
        push: z.boolean(),
        triage: z.boolean().optional(),
        pull: z.boolean()
      }).optional(),
      allow_rebase_merge: z.boolean().optional(),
      temp_clone_token: z.string().optional(),
      allow_squash_merge: z.boolean().optional(),
      allow_auto_merge: z.boolean().optional(),
      delete_branch_on_merge: z.boolean().optional(),
      allow_merge_commit: z.boolean().optional(),
      subscribers_count: z.number().optional(),
      network_count: z.number().optional(),
      license: z.object({
        key: z.string(),
        name: z.string(),
        spdx_id: z.string().nullable(),
        url: z.string().url().nullable(),
        node_id: z.string()
      }).nullable().optional(),
      forks: z.number(),
      open_issues: z.number(),
      watchers: z.number()
    }).nullable()
  }),
  base: z.object({
    label: z.string(),
    ref: z.string(),
    sha: z.string(),
    user: PullRequestUserSchema,
    repo: z.object({
      id: z.number(),
      node_id: z.string(),
      name: z.string(),
      full_name: z.string(),
      private: z.boolean(),
      owner: PullRequestUserSchema,
      html_url: z.string().url(),
      description: z.string().nullable(),
      fork: z.boolean(),
      url: z.string().url(),
      archive_url: z.string().url(),
      assignees_url: z.string().url(),
      blobs_url: z.string().url(),
      branches_url: z.string().url(),
      collaborators_url: z.string().url(),
      comments_url: z.string().url(),
      commits_url: z.string().url(),
      compare_url: z.string().url(),
      contents_url: z.string().url(),
      contributors_url: z.string().url(),
      deployments_url: z.string().url(),
      downloads_url: z.string().url(),
      events_url: z.string().url(),
      forks_url: z.string().url(),
      git_commits_url: z.string().url(),
      git_refs_url: z.string().url(),
      git_tags_url: z.string().url(),
      git_url: z.string().url(),
      issue_comment_url: z.string().url(),
      issue_events_url: z.string().url(),
      issues_url: z.string().url(),
      keys_url: z.string().url(),
      labels_url: z.string().url(),
      languages_url: z.string().url(),
      merges_url: z.string().url(),
      milestones_url: z.string().url(),
      notifications_url: z.string().url(),
      pulls_url: z.string().url(),
      releases_url: z.string().url(),
      ssh_url: z.string(),
      stargazers_url: z.string().url(),
      statuses_url: z.string().url(),
      subscribers_url: z.string().url(),
      subscription_url: z.string().url(),
      tags_url: z.string().url(),
      teams_url: z.string().url(),
      trees_url: z.string().url(),
      clone_url: z.string().url(),
      mirror_url: z.string().url().nullable(),
      hooks_url: z.string().url(),
      svn_url: z.string().url(),
      homepage: z.string().nullable(),
      language: z.string().nullable(),
      forks_count: z.number(),
      stargazers_count: z.number(),
      watchers_count: z.number(),
      size: z.number(),
      default_branch: z.string(),
      open_issues_count: z.number(),
      is_template: z.boolean().optional(),
      topics: z.array(z.string()).optional(),
      has_issues: z.boolean(),
      has_projects: z.boolean(),
      has_wiki: z.boolean(),
      has_pages: z.boolean(),
      has_downloads: z.boolean(),
      archived: z.boolean(),
      disabled: z.boolean(),
      visibility: z.enum(["public", "private"]).optional(),
      pushed_at: z.string().datetime().nullable(),
      created_at: z.string().datetime(),
      updated_at: z.string().datetime(),
      permissions: z.object({
        admin: z.boolean(),
        maintain: z.boolean().optional(),
        push: z.boolean(),
        triage: z.boolean().optional(),
        pull: z.boolean()
      }).optional(),
      allow_rebase_merge: z.boolean().optional(),
      temp_clone_token: z.string().optional(),
      allow_squash_merge: z.boolean().optional(),
      allow_auto_merge: z.boolean().optional(),
      delete_branch_on_merge: z.boolean().optional(),
      allow_merge_commit: z.boolean().optional(),
      subscribers_count: z.number().optional(),
      network_count: z.number().optional(),
      license: z.object({
        key: z.string(),
        name: z.string(),
        spdx_id: z.string().nullable(),
        url: z.string().url().nullable(),
        node_id: z.string()
      }).nullable().optional(),
      forks: z.number(),
      open_issues: z.number(),
      watchers: z.number()
    })
  }),
  _links: z.object({
    self: z.object({ href: z.string().url() }),
    html: z.object({ href: z.string().url() }),
    issue: z.object({ href: z.string().url() }),
    comments: z.object({ href: z.string().url() }),
    review_comments: z.object({ href: z.string().url() }),
    review_comment: z.object({ href: z.string().url() }),
    commits: z.object({ href: z.string().url() }),
    statuses: z.object({ href: z.string().url() })
  }),
  author_association: z.enum(["COLLABORATOR", "CONTRIBUTOR", "FIRST_TIMER", "FIRST_TIME_CONTRIBUTOR", "MANNEQUIN", "MEMBER", "NONE", "OWNER"]),
  auto_merge: z.object({
    enabled_by: PullRequestUserSchema,
    merge_method: z.enum(["merge", "squash", "rebase"]),
    commit_title: z.string(),
    commit_message: z.string()
  }).nullable(),
  draft: z.boolean().optional(),
  merged: z.boolean(),
  mergeable: z.boolean().nullable(),
  rebaseable: z.boolean().nullable(),
  mergeable_state: z.enum(["behind", "blocked", "clean", "dirty", "draft", "has_hooks", "unknown", "unstable"]),
  merged_by: PullRequestUserSchema.nullable(),
  comments: z.number(),
  review_comments: z.number(),
  maintainer_can_modify: z.boolean(),
  commits: z.number(),
  additions: z.number(),
  deletions: z.number(),
  changed_files: z.number()
}).partial({
  body: true,
  milestone: true,
  active_lock_reason: true,
  closed_at: true,
  merged_at: true,
  merge_commit_sha: true,
  assignee: true,
  requested_teams: true,
  _links: true,
  auto_merge: true,
  draft: true,
  mergeable: true,
  rebaseable: true,
  merged_by: true
});
z.object({
  id: z.number(),
  node_id: z.string(),
  url: z.string().url(),
  html_url: z.string().url(),
  body: z.string(),
  user: PullRequestUserSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  issue_url: z.string().url(),
  author_association: z.enum(["COLLABORATOR", "CONTRIBUTOR", "FIRST_TIMER", "FIRST_TIME_CONTRIBUTOR", "MANNEQUIN", "MEMBER", "NONE", "OWNER"]),
  performed_via_github_app: z.record(z.any()).nullable().optional(),
  reactions: z.object({
    url: z.string().url(),
    total_count: z.number(),
    "+1": z.number(),
    "-1": z.number(),
    laugh: z.number(),
    hooray: z.number(),
    confused: z.number(),
    heart: z.number(),
    rocket: z.number(),
    eyes: z.number()
  }).optional()
}).partial({
  performed_via_github_app: true,
  reactions: true
});
z.object({
  id: z.number(),
  node_id: z.string(),
  user: PullRequestUserSchema,
  body: z.string().nullable(),
  state: z.enum(["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED", "PENDING"]),
  html_url: z.string().url(),
  pull_request_url: z.string().url(),
  _links: z.object({
    html: z.object({ href: z.string().url() }),
    pull_request: z.object({ href: z.string().url() })
  }),
  submitted_at: z.string().datetime().nullable(),
  commit_id: z.string(),
  author_association: z.enum(["COLLABORATOR", "CONTRIBUTOR", "FIRST_TIMER", "FIRST_TIME_CONTRIBUTOR", "MANNEQUIN", "MEMBER", "NONE", "OWNER"])
}).partial({
  body: true,
  submitted_at: true,
  _links: true
});
const BaseOutputSchema = (dataSchema) => z.object({
  status: z.enum(["success", "error"]),
  data: dataSchema.optional(),
  errorMessage: z.string().optional(),
  metadata: z.object({
    request_id: z.string().optional(),
    rate_limit_remaining: z.number().optional(),
    rate_limit_reset: z.string().datetime().optional()
  }).optional()
}).strict();
const PullRequestsListOutputSchema = BaseOutputSchema(z.array(PullRequestSchema.pick({
  id: true,
  number: true,
  title: true,
  state: true,
  user: true,
  body: true,
  html_url: true,
  created_at: true,
  updated_at: true,
  merged: true,
  mergeable: true,
  comments: true,
  review_comments: true,
  commits: true,
  additions: true,
  deletions: true,
  changed_files: true
})));
const parseGitHubError = (error) => {
  if (error !== null && typeof error === "object" && "status" in error) {
    const ghError = error;
    return {
      status: ghError.status,
      message: ghError.message ?? "Unknown GitHub API error",
      documentation_url: ghError.documentation_url,
      request_id: ghError.request?.id,
      rate_limit_remaining: ghError.response?.headers?.["x-ratelimit-remaining"],
      rate_limit_reset: ghError.response?.headers?.["x-ratelimit-reset"]
    };
  }
  return {
    status: 500,
    message: error instanceof Error ? error.message : String(error),
    documentation_url: void 0,
    request_id: void 0,
    rate_limit_remaining: void 0,
    rate_limit_reset: void 0
  };
};
const listPullRequests = createTool$1({
  id: "listPullRequests",
  description: "Lists pull requests for a repository with pagination support. Supports filtering by state and handles large result sets efficiently.",
  inputSchema: z.object({
    owner: z.string().describe("Repository owner (username or organization)"),
    repo: z.string().describe("Repository name"),
    state: z.enum(["open", "closed", "all"]).optional().default("open").describe("Filter by pull request state"),
    per_page: z.number().min(1).max(100).optional().default(30).describe("Number of results per page"),
    page: z.number().min(1).optional().default(1).describe("Page number for pagination"),
    sort: z.enum(["created", "updated", "popularity", "long-running"]).optional().default("created").describe("Sort order"),
    direction: z.enum(["asc", "desc"]).optional().default("desc").describe("Sort direction")
  }),
  outputSchema: PullRequestsListOutputSchema,
  execute: async ({ context, tracingContext }) => {
    const spanName = tracingContext?.currentSpan?.createChildSpan({
      type: AISpanType.GENERIC,
      name: "list_pull_requests",
      input: { owner: context.owner, repo: context.repo, state: context.state, per_page: context.per_page, page: context.page }
    });
    try {
      const prs = await octokit.pulls.list({
        owner: context.owner,
        repo: context.repo,
        state: context.state,
        per_page: context.per_page,
        page: context.page,
        sort: context.sort,
        direction: context.direction
      });
      logger$a.info("Pull requests listed successfully", {
        count: prs.data.length,
        owner: context.owner,
        repo: context.repo
      });
      spanName?.end({
        output: { prs_count: prs.data.length, has_more: prs.data.length === context.per_page },
        metadata: {
          operation: "list_pull_requests",
          rate_limit_remaining: prs.headers?.["x-ratelimit-remaining"],
          rate_limit_reset: prs.headers?.["x-ratelimit-reset"]
        }
      });
      return BaseOutputSchema(z.array(PullRequestSchema.pick({
        id: true,
        number: true,
        title: true,
        state: true,
        user: true,
        body: true,
        html_url: true,
        created_at: true,
        updated_at: true,
        merged: true,
        mergeable: true,
        comments: true,
        review_comments: true,
        commits: true,
        additions: true,
        deletions: true,
        changed_files: true
      }))).parse({
        status: "success",
        data: prs.data,
        metadata: {
          request_id: prs.headers?.["x-github-request-id"],
          rate_limit_remaining: prs.headers?.["x-ratelimit-remaining"] !== void 0 ? parseInt(prs.headers["x-ratelimit-remaining"]) : void 0,
          rate_limit_reset: prs.headers?.["x-ratelimit-reset"] !== void 0 ? new Date(parseInt(prs.headers["x-ratelimit-reset"]) * 1e3).toISOString() : void 0
        }
      });
    } catch (error) {
      const parsedError = parseGitHubError(error);
      logger$a.error("Error listing pull requests", {
        error: parsedError.message,
        status: parsedError.status,
        owner: context.owner,
        repo: context.repo
      });
      spanName?.end({
        metadata: {
          error: parsedError.message,
          status: parsedError.status,
          operation: "list_pull_requests",
          rate_limit_remaining: parsedError.rate_limit_remaining,
          rate_limit_reset: parsedError.rate_limit_reset
        }
      });
      return BaseOutputSchema(z.array(PullRequestSchema.pick({
        id: true,
        number: true,
        title: true,
        state: true,
        user: true,
        body: true,
        html_url: true,
        created_at: true,
        updated_at: true,
        merged: true,
        mergeable: true,
        comments: true,
        review_comments: true,
        commits: true,
        additions: true,
        deletions: true,
        changed_files: true
      }))).parse({
        status: "error",
        errorMessage: parsedError.message,
        metadata: {
          request_id: parsedError.request_id,
          rate_limit_remaining: parsedError.rate_limit_remaining,
          rate_limit_reset: parsedError.rate_limit_reset
        }
      });
    }
  }
});
const getPullRequestOutputSchema = z.object({
  status: z.enum(["success", "error"]),
  data: z.object({
    id: z.number(),
    number: z.number(),
    title: z.string(),
    state: z.string(),
    html_url: z.string()
  }).optional(),
  errorMessage: z.string().optional().describe("Error getting pull request")
}).strict();
const getPullRequest = createTool$1({
  id: "getPullRequest",
  description: "Gets a pull request from a repository.",
  inputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    pull_number: z.number()
  }),
  outputSchema: getPullRequestOutputSchema,
  execute: async ({ context, tracingContext }) => {
    const spanName = tracingContext?.currentSpan?.createChildSpan({
      type: AISpanType.GENERIC,
      name: "get_pull_request",
      input: { owner: context.owner, repo: context.repo, pull_number: context.pull_number }
    });
    try {
      const pr = await octokit.pulls.get(context);
      logger$a.info("Pull request retrieved successfully");
      spanName?.end({
        output: { pr_number: pr.data.number, title: pr.data.title },
        metadata: { operation: "get_pull_request" }
      });
      return getPullRequestOutputSchema.parse({ status: "success", data: pr.data });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger$a.info("Error getting pull request");
      spanName?.end({
        metadata: {
          error: errorMessage,
          operation: "get_pull_request"
        }
      });
      return getPullRequestOutputSchema.parse({ status: "error", data: null, errorMessage });
    }
  }
});
const createPullRequestOutputSchema = z.object({
  status: z.enum(["success", "error"]),
  data: z.object({
    id: z.number(),
    number: z.number(),
    title: z.string(),
    state: z.string(),
    html_url: z.string()
  }).optional(),
  errorMessage: z.string().optional().describe("Error creating pull request")
}).strict();
const createPullRequest = createTool$1({
  id: "createPullRequest",
  description: "Creates a new pull request in a repository.",
  inputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    title: z.string(),
    head: z.string(),
    base: z.string(),
    body: z.string().optional(),
    draft: z.boolean().optional()
  }),
  outputSchema: createPullRequestOutputSchema,
  execute: async ({ context, tracingContext }) => {
    const spanName = tracingContext?.currentSpan?.createChildSpan({
      type: AISpanType.GENERIC,
      name: "create_pull_request",
      input: { owner: context.owner, repo: context.repo, title: context.title, head: context.head, base: context.base }
    });
    try {
      const pr = await octokit.pulls.create(context);
      logger$a.info("Pull request created successfully");
      spanName?.end({
        output: { pr_number: pr.data.number },
        metadata: { operation: "create_pull_request" }
      });
      return createPullRequestOutputSchema.parse({ status: "success", data: pr.data });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger$a.info("Error creating pull request");
      spanName?.end({
        metadata: {
          error: errorMessage,
          operation: "create_pull_request"
        }
      });
      return createPullRequestOutputSchema.parse({ status: "error", data: null, errorMessage });
    }
  }
});
const updatePullRequestOutputSchema = z.object({
  status: z.enum(["success", "error"]),
  data: z.object({
    id: z.number(),
    number: z.number(),
    title: z.string(),
    state: z.string(),
    html_url: z.string()
  }).optional(),
  errorMessage: z.string().optional().describe("Error updating pull request")
}).strict();
const updatePullRequest = createTool$1({
  id: "updatePullRequest",
  description: "Updates a pull request in a repository.",
  inputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    pull_number: z.number(),
    title: z.string().optional(),
    body: z.string().optional(),
    state: z.enum(["open", "closed"]).optional()
  }),
  outputSchema: updatePullRequestOutputSchema,
  execute: async ({ context, tracingContext }) => {
    const spanName = tracingContext?.currentSpan?.createChildSpan({
      type: AISpanType.GENERIC,
      name: "update_pull_request",
      input: { owner: context.owner, repo: context.repo, pull_number: context.pull_number }
    });
    try {
      const pr = await octokit.pulls.update(context);
      logger$a.info("Pull request updated successfully");
      spanName?.end({
        output: { pr_number: pr.data.number },
        metadata: { operation: "update_pull_request" }
      });
      return updatePullRequestOutputSchema.parse({ status: "success", data: pr.data });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger$a.info("Error updating pull request");
      spanName?.end({
        metadata: {
          error: errorMessage,
          operation: "update_pull_request"
        }
      });
      return updatePullRequestOutputSchema.parse({ status: "error", data: null, errorMessage });
    }
  }
});
const mergePullRequestOutputSchema = z.object({
  status: z.enum(["success", "error"]),
  data: z.object({
    merged: z.boolean(),
    sha: z.string(),
    message: z.string()
  }).optional(),
  errorMessage: z.string().optional().describe("Error merging pull request")
}).strict();
const mergePullRequest = createTool$1({
  id: "mergePullRequest",
  description: "Merges a pull request.",
  inputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    pull_number: z.number(),
    commit_title: z.string().optional(),
    commit_message: z.string().optional(),
    merge_method: z.enum(["merge", "squash", "rebase"]).optional()
  }),
  outputSchema: mergePullRequestOutputSchema,
  execute: async ({ context, tracingContext }) => {
    const spanName = tracingContext?.currentSpan?.createChildSpan({
      type: AISpanType.GENERIC,
      name: "merge_pull_request",
      input: { owner: context.owner, repo: context.repo, pull_number: context.pull_number, merge_method: context.merge_method }
    });
    try {
      const result = await octokit.pulls.merge(context);
      logger$a.info("Pull request merged successfully");
      spanName?.end({
        output: { merged: result.data.merged, sha: result.data.sha },
        metadata: { operation: "merge_pull_request" }
      });
      return mergePullRequestOutputSchema.parse({ status: "success", data: result.data });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger$a.info("Error merging pull request");
      spanName?.end({
        metadata: {
          error: errorMessage,
          operation: "merge_pull_request"
        }
      });
      return mergePullRequestOutputSchema.parse({ status: "error", data: null, errorMessage });
    }
  }
});
const listPullRequestCommentsOutputSchema = z.object({
  status: z.enum(["success", "error"]),
  data: z.array(z.object({
    id: z.number(),
    body: z.string(),
    user: z.object({ login: z.string() }),
    created_at: z.string()
  })).optional(),
  errorMessage: z.string().optional().describe("Error listing pull request comments")
}).strict();
const listPullRequestComments = createTool$1({
  id: "listPullRequestComments",
  description: "Lists comments on a pull request.",
  inputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    issue_number: z.number()
  }),
  outputSchema: listPullRequestCommentsOutputSchema,
  execute: async ({ context, tracingContext }) => {
    const spanName = tracingContext?.currentSpan?.createChildSpan({
      type: AISpanType.GENERIC,
      name: "list_pull_request_comments",
      input: { owner: context.owner, repo: context.repo, issue_number: context.issue_number }
    });
    try {
      const comments = await octokit.issues.listComments(context);
      logger$a.info("Pull request comments listed successfully");
      spanName?.end({
        output: { comments_count: comments.data.length },
        metadata: { operation: "list_pull_request_comments" }
      });
      return listPullRequestCommentsOutputSchema.parse({ status: "success", data: comments.data });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger$a.info("Error listing pull request comments");
      spanName?.end({
        metadata: {
          error: errorMessage,
          operation: "list_pull_request_comments"
        }
      });
      return listPullRequestCommentsOutputSchema.parse({ status: "error", data: null, errorMessage });
    }
  }
});
const createPullRequestCommentOutputSchema = z.object({
  status: z.enum(["success", "error"]),
  data: z.object({
    id: z.number(),
    body: z.string(),
    user: z.object({ login: z.string() }),
    created_at: z.string()
  }).optional(),
  errorMessage: z.string().optional().describe("Error creating pull request comment")
}).strict();
const createPullRequestComment = createTool$1({
  id: "createPullRequestComment",
  description: "Creates a comment on a pull request.",
  inputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    issue_number: z.number(),
    body: z.string()
  }),
  outputSchema: createPullRequestCommentOutputSchema,
  execute: async ({ context, tracingContext }) => {
    const spanName = tracingContext?.currentSpan?.createChildSpan({
      type: AISpanType.GENERIC,
      name: "create_pull_request_comment",
      input: { owner: context.owner, repo: context.repo, issue_number: context.issue_number }
    });
    try {
      const comment = await octokit.issues.createComment(context);
      logger$a.info("Pull request comment created successfully");
      spanName?.end({
        output: { comment_id: comment.data.id },
        metadata: { operation: "create_pull_request_comment" }
      });
      return createPullRequestCommentOutputSchema.parse({ status: "success", data: comment.data });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger$a.info("Error creating pull request comment");
      spanName?.end({
        metadata: {
          error: errorMessage,
          operation: "create_pull_request_comment"
        }
      });
      return createPullRequestCommentOutputSchema.parse({ status: "error", data: null, errorMessage });
    }
  }
});
const updatePullRequestCommentOutputSchema = z.object({
  status: z.enum(["success", "error"]),
  data: z.object({
    id: z.number(),
    body: z.string(),
    user: z.object({ login: z.string() }),
    updated_at: z.string()
  }).optional(),
  errorMessage: z.string().optional().describe("Error updating pull request comment")
}).strict();
const updatePullRequestComment = createTool$1({
  id: "updatePullRequestComment",
  description: "Updates a comment on a pull request.",
  inputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    comment_id: z.number(),
    body: z.string()
  }),
  outputSchema: updatePullRequestCommentOutputSchema,
  execute: async ({ context, tracingContext }) => {
    const spanName = tracingContext?.currentSpan?.createChildSpan({
      type: AISpanType.GENERIC,
      name: "update_pull_request_comment",
      input: { owner: context.owner, repo: context.repo, comment_id: context.comment_id }
    });
    try {
      const comment = await octokit.issues.updateComment(context);
      logger$a.info("Pull request comment updated successfully");
      spanName?.end({
        output: { comment_id: comment.data.id },
        metadata: { operation: "update_pull_request_comment" }
      });
      return updatePullRequestCommentOutputSchema.parse({ status: "success", data: comment.data });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger$a.info("Error updating pull request comment");
      spanName?.end({
        metadata: {
          error: errorMessage,
          operation: "update_pull_request_comment"
        }
      });
      return updatePullRequestCommentOutputSchema.parse({ status: "error", data: null, errorMessage });
    }
  }
});
const deletePullRequestCommentOutputSchema = z.object({
  status: z.enum(["success", "error"]),
  data: z.object({ success: z.boolean() }).optional(),
  errorMessage: z.string().optional().describe("Error deleting pull request comment")
}).strict();
const deletePullRequestComment = createTool$1({
  id: "deletePullRequestComment",
  description: "Deletes a comment on a pull request.",
  inputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    comment_id: z.number()
  }),
  outputSchema: deletePullRequestCommentOutputSchema,
  execute: async ({ context, tracingContext }) => {
    const spanName = tracingContext?.currentSpan?.createChildSpan({
      type: AISpanType.GENERIC,
      name: "delete_pull_request_comment",
      input: { owner: context.owner, repo: context.repo, comment_id: context.comment_id }
    });
    try {
      await octokit.issues.deleteComment(context);
      logger$a.info("Pull request comment deleted successfully");
      spanName?.end({
        output: { success: true },
        metadata: { operation: "delete_pull_request_comment" }
      });
      return deletePullRequestCommentOutputSchema.parse({ status: "success", data: { success: true } });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger$a.info("Error deleting pull request comment");
      spanName?.end({
        metadata: {
          error: errorMessage,
          operation: "delete_pull_request_comment"
        }
      });
      return deletePullRequestCommentOutputSchema.parse({ status: "error", data: { success: false }, errorMessage });
    }
  }
});
const listPullRequestReviewsOutputSchema = z.object({
  status: z.enum(["success", "error"]),
  data: z.array(z.object({
    id: z.number(),
    user: z.object({ login: z.string() }),
    state: z.string(),
    body: z.string().optional(),
    submitted_at: z.string().optional()
  })).optional(),
  errorMessage: z.string().optional().describe("Error listing pull request reviews")
}).strict();
const listPullRequestReviews = createTool$1({
  id: "listPullRequestReviews",
  description: "Lists reviews on a pull request.",
  inputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    pull_number: z.number()
  }),
  outputSchema: listPullRequestReviewsOutputSchema,
  execute: async ({ context, tracingContext }) => {
    const spanName = tracingContext?.currentSpan?.createChildSpan({
      type: AISpanType.GENERIC,
      name: "list_pull_request_reviews",
      input: { owner: context.owner, repo: context.repo, pull_number: context.pull_number }
    });
    try {
      const reviews = await octokit.pulls.listReviews(context);
      logger$a.info("Pull request reviews listed successfully");
      spanName?.end({
        output: { reviews_count: reviews.data.length },
        metadata: { operation: "list_pull_request_reviews" }
      });
      return listPullRequestReviewsOutputSchema.parse({ status: "success", data: reviews.data });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger$a.info("Error listing pull request reviews");
      spanName?.end({
        metadata: {
          error: errorMessage,
          operation: "list_pull_request_reviews"
        }
      });
      return listPullRequestReviewsOutputSchema.parse({ status: "error", data: null, errorMessage });
    }
  }
});
const createPullRequestReviewOutputSchema = z.object({
  status: z.enum(["success", "error"]),
  data: z.object({
    id: z.number(),
    user: z.object({ login: z.string() }),
    state: z.string(),
    body: z.string().optional(),
    submitted_at: z.string().optional()
  }).optional(),
  errorMessage: z.string().optional().describe("Error creating pull request review")
}).strict();
const createPullRequestReview = createTool$1({
  id: "createPullRequestReview",
  description: "Creates a review on a pull request.",
  inputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    pull_number: z.number(),
    body: z.string().optional(),
    event: z.enum(["APPROVE", "REQUEST_CHANGES", "COMMENT"]).optional(),
    comments: z.array(z.object({
      path: z.string(),
      position: z.number(),
      body: z.string()
    })).optional()
  }),
  outputSchema: createPullRequestReviewOutputSchema,
  execute: async ({ context, tracingContext }) => {
    const spanName = tracingContext?.currentSpan?.createChildSpan({
      type: AISpanType.GENERIC,
      name: "create_pull_request_review",
      input: { owner: context.owner, repo: context.repo, pull_number: context.pull_number }
    });
    try {
      const review = await octokit.pulls.createReview(context);
      logger$a.info("Pull request review created successfully");
      spanName?.end({
        output: { review_id: review.data.id },
        metadata: { operation: "create_pull_request_review" }
      });
      return createPullRequestReviewOutputSchema.parse({ status: "success", data: review.data });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger$a.info("Error creating pull request review");
      spanName?.end({
        metadata: {
          error: errorMessage,
          operation: "create_pull_request_review"
        }
      });
      return createPullRequestReviewOutputSchema.parse({ status: "error", data: null, errorMessage });
    }
  }
});

const logger$9 = new PinoLogger({ level: "info" });
logger$9.info("Initializing GitHub Agent...");
const memory$6 = createResearchMemory();
const githubAgent = new Agent$1({
  id: "github-agent",
  name: "GitHub Agent",
  description: "An advanced AI-powered GitHub Assistant designed to streamline and enhance user interactions with GitHub repositories and resources.",
  instructions: `You are an advanced AI-powered GitHub Assistant, meticulously designed to streamline and enhance user interactions with GitHub repositories and associated resources. Your primary role is to act as an intelligent interface, interpreting user commands, executing actions via the GitHub API, and providing comprehensive, actionable feedback. You manage various GitHub entities including repositories, issues, pull requests, users, and organizations.

**Core Capabilities:**
- **GitHub API Interaction:** You are equipped with a suite of specialized tools that directly interface with the GitHub API, enabling you to perform a wide range of operations.
- **Issue Management:** Create, retrieve, update, list, and manage comments on issues within repositories.
- **Repository Management:** List, create, retrieve, update, delete, and manage settings for repositories.
- **Pull Request Management:** List, retrieve, create, update, merge, close, and manage comments and reviews on pull requests.
- **User Management:** Retrieve information about the authenticated user, search for users by username, and list users within an organization or globally (where applicable and permitted).
- **Organization Management:** Retrieve organization details, list organizations, and list members of an organization.

**Behavioral Guidelines:**
- **Clarity and Conciseness:** Ensure all responses are easy to understand, directly address the user's query, and avoid unnecessary jargon.
- **Accuracy and Reliability:** Provide precise information based on real-time API responses and ensure all actions are executed correctly.
- **Helpfulness and Proactive Guidance:** Anticipate user needs, proactively offer relevant suggestions, clarifications, or next steps, and guide users effectively through complex operations.
- **Professionalism:** Maintain a polite, respectful, and professional tone in all interactions.
- **Robust Error Handling:** Gracefully handle API errors, invalid requests, or unexpected situations. When an error occurs, clearly explain the issue, suggest potential causes, and provide actionable next steps or alternative solutions to the user.

**Constraints & Boundaries:**
- **API-Centric Operations:** Strictly operate within the confines of the provided GitHub API tools. Never attempt to bypass API limitations, security protocols, or perform actions outside the scope of the API.
- **User Confirmation for Destructive Actions:** Do not perform any destructive or irreversible actions (e.g., deleting a repository, merging a pull request) without explicit, unambiguous user confirmation.
- **Rate Limit Adherence:** Strictly adhere to GitHub's API rate limits and usage policies to ensure service stability and prevent abuse.
- **Security and Privacy:** Handle all user data and GitHub resource information with the utmost confidentiality and security. Do not expose sensitive information or perform unauthorized data access.
- **Scope Limitation:** Do not engage in activities outside of GitHub resource management.

**Success Criteria:**
- **Efficient and Accurate Fulfillment:** User requests are fulfilled accurately, efficiently, and reliably, leading to successful task completion.
- **Exceptional User Experience:** Responses are consistently clear, helpful, and timely, minimizing user frustration and maximizing productivity.
- **Effective Error Resolution:** Errors are handled professionally and informatively, guiding users towards resolution and maintaining a positive interaction.
- **Operational Compliance:** All operations strictly adhere to GitHub's policies and API best practices.

---

**GitHub Copilot Agent Interaction:**
You possess the advanced capability to delegate tasks and request analysis from GitHub's native Copilot agent. This is a powerful feature for automating complex coding and review tasks. Your interaction with the Copilot agent is governed by two distinct mechanisms:

1.  **Task Delegation via Issue Assignment:**
    *   **Trigger:** Assigning a GitHub Issue to the user \`@github-copilot\`.
    *   **Purpose:** To delegate a complete coding task, such as a feature implementation, bug fix, or code refactoring.
    *   **Action:** When a user asks you to have Copilot build a feature, your tool must first create a highly detailed issue. The body of this issue serves as the primary prompt for the Copilot agent. Immediately after creation, your tool will assign this issue to \`@github-copilot\`.
    *   **Outcome:** The Copilot agent will accept the task, create a new branch, write the code, and submit a new pull request linked to the original issue. You should inform the user that the task has been successfully delegated and a PR will be generated shortly.

2.  **Code Analysis via Pull Request Comments:**
    *   **Trigger:** Mentioning the user \`@github-copilot\` in a comment on a pull request.
    *   **Purpose:** To request analysis, explanation, or suggestions on the code within that specific pull request. This is for review and understanding, not for writing new code.
    *   **Action:** When a user asks for Copilot's opinion on a PR, your tool will create a comment on that PR, starting with \`@github-copilot\` followed by the user's question.
    *   **Outcome:** The Copilot agent will post a reply to the comment thread with its analysis or answer.

**Prerequisites & Constraints for Copilot Interaction:**
- **Copilot Enterprise Required:** These features will only function in repositories that are part of an organization with an active GitHub Copilot Enterprise subscription. If an action fails, you should suggest this as a potential cause.
- **Clarity is Paramount:** The quality of the Copilot agent's work is directly proportional to the quality of your issue description or comment. Always create detailed, specific, and unambiguous prompts for the Copilot agent.
`,
  model: google("gemini-2.5-flash"),
  tools: {
    //   listWorkflowRuns,
    searchCode,
    searchIssuesAndPullRequests,
    searchRepositories,
    searchUsers,
    listPullRequests,
    getPullRequest,
    createPullRequest,
    updatePullRequest,
    mergePullRequest,
    listPullRequestComments,
    createPullRequestComment,
    updatePullRequestComment,
    deletePullRequestComment,
    listPullRequestReviews,
    createPullRequestReview
  },
  evals: {
    contentSimilarity: new ContentSimilarityMetric({ ignoreCase: true, ignoreWhitespace: true }),
    completeness: new CompletenessMetric(),
    textualDifference: new TextualDifferenceMetric(),
    keywordCoverage: new KeywordCoverageMetric(),
    // Keywords will be provided at runtime for evaluation
    toneConsistency: new ToneConsistencyMetric()
  },
  memory: memory$6
});
logger$9.info("GitHub Agent initialized successfully");

const logger$8 = new PinoLogger({ level: "info" });
logger$8.info("Initializing Monitor Agent...");
const memory$5 = createResearchMemory();
const monitorAgent = new Agent({
  id: "monitor-agent",
  name: "Monitor Agent",
  description: "An expert monitoring and observability specialist focused on proactive system health management.",
  instructions: `You are an expert monitoring and observability specialist focused on proactive system health management. Your primary role is to monitor system performance, detect anomalies, and ensure operational stability through comprehensive data analysis and alerting.

**Core Purpose:**
- Monitor system health, performance metrics, and operational status
- Track application performance and identify bottlenecks
- Analyze error rates and exception patterns
- Perform log analysis and correlation
- Coordinate health checks across systems
- Identify performance bottlenecks and optimization opportunities

**Key Capabilities:**
- **System Resource Monitoring:** Track CPU usage, memory consumption, disk utilization, and network I/O
- **Application Performance Tracking:** Monitor response times, throughput, error rates, and user experience metrics
- **Error Analysis:** Identify patterns in error logs, exceptions, and failure modes
- **Log Analysis:** Parse, correlate, and analyze log files for insights and anomalies
- **Health Check Coordination:** Run automated health checks and aggregate results
- **Performance Bottleneck Identification:** Analyze metrics to identify slow queries, memory leaks, and resource constraints
- **Alert Management:** Generate alerts based on thresholds and anomaly detection
- **Trend Analysis:** Identify performance trends and capacity planning needs

**Behavioral Guidelines:**
- **Proactive Monitoring:** Continuously monitor systems and proactively identify potential issues before they become critical
- **Data-Driven Analysis:** Base all conclusions on actual metrics, logs, and performance data
- **Comprehensive Coverage:** Monitor all aspects of system health including infrastructure, applications, and user experience
- **Alert Prioritization:** Focus on critical issues first, then performance degradation, then optimization opportunities
- **Clear Communication:** Provide detailed, actionable insights with specific recommendations
- **Historical Context:** Consider trends and historical data when analyzing current performance
- **Root Cause Analysis:** Dig deep to identify underlying causes rather than just symptoms

**Constraints & Boundaries:**
- **Data Integrity:** Only analyze data from verified sources and maintain data security
- **Resource Awareness:** Be mindful of monitoring overhead and avoid impacting system performance
- **Scope Limitation:** Focus on monitoring and analysis, not direct system administration
- **Ethical Monitoring:** Respect privacy and security when analyzing logs and metrics
- **Threshold Management:** Use appropriate thresholds that balance sensitivity with false positive reduction

**Success Criteria:**
- **Early Detection:** Identify issues before they impact users or business operations
- **Accurate Analysis:** Provide correct root cause analysis and actionable recommendations
- **Comprehensive Coverage:** Monitor all critical system components and performance indicators
- **Timely Response:** Generate alerts and insights within appropriate timeframes
- **Actionable Insights:** Provide specific, implementable recommendations for issues found

**Monitoring Process:**
1. **Data Collection:** Gather metrics, logs, and performance data from all monitored systems
2. **Analysis Phase:** Analyze collected data for anomalies, trends, and potential issues
3. **Correlation:** Correlate events across different systems and components
4. **Alert Generation:** Generate appropriate alerts based on severity and impact
5. **Reporting:** Provide comprehensive reports with insights and recommendations
6. **Trend Tracking:** Maintain historical data for trend analysis and capacity planning

**Tool Usage Guidelines:**
- Use data-file-manager tools to store and retrieve monitoring data and logs
- Use web-scraper-tool to collect external monitoring data and status pages
- Use evaluateResultTool to assess the quality and relevance of monitoring data
- Use extractLearningsTool to identify patterns and insights from log analysis
- Store all monitoring results and analysis in the data directory for historical tracking

Always maintain detailed logs of your monitoring activities and analysis for audit and improvement purposes.`,
  evals: {
    contentSimilarity: new ContentSimilarityMetric({ ignoreCase: true, ignoreWhitespace: true }),
    completeness: new CompletenessMetric(),
    textualDifference: new TextualDifferenceMetric(),
    keywordCoverage: new KeywordCoverageMetric(),
    // Keywords will be provided at runtime for evaluation
    toneConsistency: new ToneConsistencyMetric()
  },
  model: google("gemini-2.5-flash-lite"),
  tools: {
    readDataFileTool,
    writeDataFileTool,
    listDataDirTool,
    searchDataFilesTool,
    getDataFileInfoTool,
    webScraperTool,
    evaluateResultTool,
    extractLearningsTool
  },
  memory: memory$5
});
logger$8.info("Monitor Agent initialized successfully");

const logger$7 = new PinoLogger({ level: "info" });
logger$7.info("Initializing Planning Agent...");
const memory$4 = createResearchMemory();
const planningAgent = new Agent({
  id: "planning-agent",
  name: "Planning Agent",
  description: "An expert strategic planning and project management specialist focused on comprehensive project coordination and workflow optimization.",
  instructions: `You are an expert strategic planning and project management specialist focused on comprehensive project coordination and workflow optimization. Your primary role is to create detailed project plans, manage resources effectively, and ensure successful project execution through systematic planning and monitoring.

**Core Purpose:**
- Strategic planning and roadmap development for complex projects
- Project coordination and workflow optimization
- Resource allocation and scheduling management
- Risk assessment and mitigation planning
- Progress tracking and milestone management
- Task breakdown and prioritization

**Key Capabilities:**
- **Project Planning:** Create comprehensive project plans with timelines, milestones, and deliverables
- **Task Breakdown:** Decompose complex projects into manageable tasks with dependencies
- **Resource Allocation:** Optimize resource distribution across tasks and team members
- **Risk Management:** Identify potential risks and develop mitigation strategies
- **Progress Tracking:** Monitor project progress against milestones and adjust plans as needed
- **Workflow Optimization:** Streamline processes and identify efficiency improvements
- **Schedule Management:** Create realistic timelines and manage project schedules
- **Stakeholder Coordination:** Manage communication and expectations across project stakeholders

**Behavioral Guidelines:**
- **Systematic Approach:** Follow structured planning methodologies and maintain comprehensive documentation
- **Data-Driven Planning:** Base all plans on thorough research and analysis of requirements
- **Risk-Aware Planning:** Proactively identify and mitigate potential project risks
- **Resource Optimization:** Maximize efficiency while ensuring quality and timeline adherence
- **Clear Communication:** Provide detailed, actionable plans with clear milestones and deliverables
- **Adaptive Planning:** Regularly review and adjust plans based on new information and changing conditions
- **Stakeholder Focus:** Consider all stakeholder needs and maintain clear communication channels

**Constraints & Boundaries:**
- **Scope Management:** Clearly define project scope and avoid scope creep
- **Resource Limits:** Work within defined resource constraints and budget limitations
- **Timeline Realism:** Create achievable timelines based on available resources and complexity
- **Quality Standards:** Maintain high quality standards while optimizing for efficiency
- **Documentation:** Maintain comprehensive records of all planning decisions and changes
- **Ethical Planning:** Ensure all plans comply with organizational policies and ethical standards

**Success Criteria:**
- **Comprehensive Planning:** Create detailed, actionable project plans covering all aspects
- **Risk Mitigation:** Identify and address potential risks before they impact the project
- **Resource Efficiency:** Optimize resource utilization while meeting project objectives
- **Timeline Adherence:** Deliver projects on time through effective planning and monitoring
- **Stakeholder Satisfaction:** Meet or exceed stakeholder expectations through clear communication
- **Process Improvement:** Continuously identify and implement workflow optimizations

**Planning Process:**
1. **Requirements Analysis:** Gather and analyze all project requirements and constraints
2. **Scope Definition:** Clearly define project scope, objectives, and deliverables
3. **Task Breakdown:** Decompose project into manageable tasks with dependencies
4. **Resource Planning:** Identify required resources and create allocation plans
5. **Schedule Development:** Create realistic timelines with milestones and critical paths
6. **Risk Assessment:** Identify potential risks and develop mitigation strategies
7. **Plan Documentation:** Create comprehensive project plans and documentation
8. **Progress Monitoring:** Track progress and adjust plans as needed
9. **Optimization:** Continuously identify and implement process improvements

**Tool Usage Guidelines:**
- Use data-file-manager tools to store and retrieve project plans, schedules, and documentation
- Use web-scraper-tool to collect research data and industry best practices for planning
- Use webSearchTool to research planning methodologies and gather relevant information
- Use evaluateResultTool to assess the quality and feasibility of planning approaches
- Use extractLearningsTool to identify best practices and lessons from previous projects
- Store all planning documents in organized directories within the data folder
- Maintain version control of plans and track changes over time

**Output Structure:**
Return planning results in structured JSON format with:
- projectOverview: High-level project summary and objectives
- taskBreakdown: Detailed task list with dependencies and estimates
- resourcePlan: Resource allocation and scheduling information
- riskAssessment: Identified risks and mitigation strategies
- timeline: Project timeline with milestones and critical paths
- progressMetrics: Key performance indicators and tracking methods
- recommendations: Actionable recommendations for successful execution

Always maintain detailed records of your planning activities and decisions for audit and improvement purposes.`,
  evals: {
    contentSimilarity: new ContentSimilarityMetric({ ignoreCase: true, ignoreWhitespace: true }),
    completeness: new CompletenessMetric(),
    textualDifference: new TextualDifferenceMetric(),
    keywordCoverage: new KeywordCoverageMetric(),
    // Keywords will be provided at runtime for evaluation
    toneConsistency: new ToneConsistencyMetric()
  },
  model: google("gemini-2.5-flash-lite"),
  tools: {
    readDataFileTool,
    writeDataFileTool,
    listDataDirTool,
    searchDataFilesTool,
    getDataFileInfoTool,
    webScraperTool,
    webSearchTool,
    evaluateResultTool,
    extractLearningsTool
  },
  memory: memory$4
});
logger$7.info("Planning Agent initialized successfully");

const logger$6 = new PinoLogger({ level: "info" });
logger$6.info("Initializing Quality Assurance Agent...");
const memory$3 = createResearchMemory();
const qualityAssuranceAgent = new Agent({
  id: "quality-assurance-agent",
  name: "Quality Assurance Agent",
  description: "An agent specialized in quality assurance and testing for software projects.",
  instructions: `You are an expert quality assurance and testing specialist focused on comprehensive software quality management and defect prevention. Your primary role is to ensure software quality through systematic testing, quality metrics tracking, and continuous improvement processes.

**Core Purpose:**
- Quality assurance coordination and testing strategy development
- Automated and manual testing orchestration
- Quality metrics collection and analysis
- Defect analysis and root cause identification
- Code review and standards enforcement
- Quality process optimization and continuous improvement

**Key Capabilities:**
- **Test Planning & Strategy:** Create comprehensive test plans, define test cases, and establish testing methodologies
- **Automated Testing Coordination:** Manage automated test suites, CI/CD integration, and test automation frameworks
- **Manual Testing Coordination:** Organize manual testing efforts, user acceptance testing, and exploratory testing
- **Quality Metrics Tracking:** Monitor KPIs like defect density, test coverage, mean time to detect/resolve defects
- **Defect Analysis:** Perform root cause analysis, defect pattern identification, and trend analysis
- **Code Review:** Conduct thorough code reviews, enforce coding standards, and identify quality issues
- **Quality Process Optimization:** Continuously improve testing processes, tools, and methodologies
- **Risk Assessment:** Identify quality risks and prioritize testing efforts based on impact and likelihood

**Behavioral Guidelines:**
- **Comprehensive Coverage:** Ensure all aspects of software quality are addressed through systematic testing approaches
- **Data-Driven Analysis:** Base all quality decisions on metrics, test results, and empirical evidence
- **Proactive Quality Management:** Focus on defect prevention rather than just detection
- **Standards Compliance:** Enforce coding standards, testing best practices, and quality requirements
- **Clear Communication:** Provide detailed, actionable quality reports with specific recommendations
- **Risk-Based Testing:** Prioritize testing efforts based on business impact and defect likelihood
- **Continuous Improvement:** Regularly assess and improve quality processes and methodologies

**Constraints & Boundaries:**
- **Quality Standards:** Maintain high quality standards while balancing speed and cost considerations
- **Resource Awareness:** Be mindful of testing resource requirements and optimize test efficiency
- **Scope Management:** Focus on quality assurance and testing, not direct development or deployment
- **Ethical Testing:** Respect data privacy, security requirements, and legal compliance in testing
- **Tool Integration:** Work within the provided tool ecosystem for quality management

**Success Criteria:**
- **Defect Prevention:** Identify and prevent defects before they reach production
- **Comprehensive Testing:** Achieve adequate test coverage across all critical functionality
- **Quality Metrics:** Maintain quality metrics within acceptable thresholds
- **Timely Delivery:** Complete quality assurance activities within project timelines
- **Actionable Insights:** Provide specific, implementable recommendations for quality improvements
- **Process Efficiency:** Continuously optimize testing processes and reduce time-to-quality

**Quality Assurance Process:**
1. **Planning Phase:** Define quality requirements, create test plans, and establish quality metrics
2. **Test Design:** Develop test cases, test scripts, and test data based on requirements
3. **Test Execution:** Coordinate automated and manual testing across different environments
4. **Defect Management:** Track, analyze, and resolve defects with root cause analysis
5. **Quality Analysis:** Review test results, analyze quality metrics, and identify trends
6. **Reporting:** Generate comprehensive quality reports with insights and recommendations
7. **Process Improvement:** Assess current processes and implement quality improvements

**Tool Usage Guidelines:**
- Use data-file-manager tools to store test plans, test results, quality metrics, and defect reports
- Use web-scraper-tool to collect testing resources, industry standards, and quality best practices
- Use evaluateResultTool to assess the quality and relevance of testing approaches and results
- Use extractLearningsTool to identify patterns in defects and quality issues
- Store all quality assurance artifacts in organized directories within the data folder
- Maintain version control of test plans, test cases, and quality documentation

**Output Structure:**
Return quality assurance results in structured JSON format with:
- qualityOverview: High-level quality assessment and current status
- testCoverage: Test coverage metrics and gap analysis
- defectAnalysis: Defect trends, root causes, and prevention recommendations
- qualityMetrics: Key quality indicators and performance measurements
- testResults: Summary of test execution results and findings
- recommendations: Actionable recommendations for quality improvements
- riskAssessment: Quality risks and mitigation strategies

Always maintain detailed logs of your quality assurance activities and analysis for audit and improvement purposes.`,
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
logger$6.info("Quality Assurance Agent initialized successfully");

const logger$5 = new PinoLogger({ level: "info" });
const getProjectDetailsStep = createStep({
  id: "get-project-details",
  inputSchema: z.object({}),
  outputSchema: z.object({
    projectName: z.string(),
    repositoryUrl: z.string()
  }),
  resumeSchema: z.object({
    projectName: z.string(),
    repositoryUrl: z.string()
  }),
  suspendSchema: z.object({
    message: z.object({
      projectName: z.string(),
      repositoryUrl: z.string()
    })
  }),
  execute: async ({ resumeData, suspend }) => {
    if (resumeData) {
      return {
        ...resumeData,
        projectName: resumeData.projectName || "",
        repositoryUrl: resumeData.repositoryUrl || ""
      };
    }
    await suspend({
      message: {
        projectName: "Enter the GitHub project name",
        repositoryUrl: "Enter the GitHub repository URL"
      }
    });
    return {
      projectName: "",
      repositoryUrl: ""
    };
  }
});
const createProjectPlanStep = createStep({
  id: "create-project-plan",
  inputSchema: z.object({
    projectName: z.string(),
    repositoryUrl: z.string()
  }),
  outputSchema: z.object({
    plan: z.string()
  }),
  execute: async ({ inputData }) => {
    const { projectName, repositoryUrl } = inputData;
    try {
      const result = await planningAgent.generate([
        {
          role: "user",
          content: `Create a detailed project plan for GitHub repository: ${repositoryUrl}
          Project: ${projectName}

          Include timeline, milestones, and resource requirements.`
        }
      ]);
      return { plan: result.text };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger$5.error("Error creating project plan", { error: message });
      return { plan: `Error: ${message}` };
    }
  }
});
const monitorRepositoryStep = createStep({
  id: "monitor-repository",
  inputSchema: z.object({
    repositoryUrl: z.string(),
    plan: z.string()
  }),
  outputSchema: z.object({
    monitoringReport: z.string()
  }),
  execute: async ({ inputData }) => {
    const { repositoryUrl, plan } = inputData;
    try {
      const result = await monitorAgent.generate([
        {
          role: "user",
          content: `Monitor the GitHub repository: ${repositoryUrl}
          Project Plan: ${plan}

          Provide health status, activity metrics, and progress tracking.`
        }
      ]);
      return { monitoringReport: result.text };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger$5.error("Error monitoring repository", { error: message });
      return { monitoringReport: `Error: ${message}` };
    }
  }
});
const generateGithubTasksStep = createStep({
  id: "generate-github-tasks",
  inputSchema: z.object({
    plan: z.string(),
    monitoringReport: z.string()
  }),
  outputSchema: z.object({
    tasks: z.string()
  }),
  execute: async ({ inputData }) => {
    const { plan, monitoringReport } = inputData;
    try {
      const result = await githubAgent.generate([
        {
          role: "user",
          content: `Based on the project plan and monitoring report, suggest GitHub tasks to create:

          Plan: ${plan}
          Monitoring: ${monitoringReport}

          Suggest issues, milestones, and project board items.`
        }
      ]);
      return { tasks: result.text };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger$5.error("Error generating GitHub tasks", { error: message });
      return { tasks: `Error: ${message}` };
    }
  }
});
const githubPlanningWorkflow = createWorkflow({
  id: "github-planning-workflow",
  inputSchema: z.object({}),
  outputSchema: z.object({
    plan: z.string(),
    monitoringReport: z.string(),
    tasks: z.string()
  }),
  steps: [getProjectDetailsStep, createProjectPlanStep, monitorRepositoryStep, generateGithubTasksStep]
});
githubPlanningWorkflow.then(getProjectDetailsStep).then(createProjectPlanStep).then(monitorRepositoryStep).then(generateGithubTasksStep).commit();

const logger$4 = new PinoLogger({ level: "info" });
const processPlanningResultsStep = createStep({
  id: "process-planning-results",
  inputSchema: z.object({
    plan: z.string(),
    monitoringReport: z.string(),
    tasks: z.string()
  }),
  outputSchema: z.object({
    qaAnalysis: z.string(),
    completed: z.boolean()
  }),
  execute: async ({ inputData }) => {
    const { plan, monitoringReport, tasks } = inputData;
    try {
      const result = await qualityAssuranceAgent.generate([
        {
          role: "user",
          content: `Perform quality assurance analysis on this GitHub project planning:

          Project Plan: ${plan}
          Monitoring Report: ${monitoringReport}
          Generated Tasks: ${tasks}

          Assess quality, identify risks, and provide recommendations.`
        }
      ]);
      return { qaAnalysis: result.text, completed: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger$4.error("Error in QA analysis", { error: message });
      return { qaAnalysis: `Error: ${message}`, completed: false };
    }
  }
});
const githubQualityWorkflow = createWorkflow({
  id: "github-quality-workflow",
  steps: [githubPlanningWorkflow, processPlanningResultsStep],
  inputSchema: z.object({}),
  outputSchema: z.object({
    plan: z.string(),
    monitoringReport: z.string(),
    tasks: z.string(),
    qaAnalysis: z.string(),
    completed: z.boolean()
  })
});
githubQualityWorkflow.then(githubPlanningWorkflow).then(processPlanningResultsStep).commit();

const copywriterTool = createTool({
  id: "copywriter-agent",
  description: "Calls the copywriter agent to write blog post copy.",
  inputSchema: z.object({
    topic: z.string()
  }),
  outputSchema: z.object({
    copy: z.string()
  }),
  execute: async ({ context, mastra }) => {
    const { topic } = context;
    const agent = mastra.getAgent("copywriterAgent");
    const result = await agent.generate(`Create a blog post about ${topic}`);
    return {
      copy: result.text
    };
  }
});

const editorTool = createTool({
  id: "editor-agent",
  description: "Calls the editor agent to edit blog post copy.",
  inputSchema: z.object({
    copy: z.string()
  }),
  outputSchema: z.object({
    copy: z.string()
  }),
  execute: async ({ context, mastra }) => {
    const { copy } = context;
    const agent = mastra.getAgent("editorAgent");
    const result = await agent.generate(`Edit the following blog post only returning the edited copy: ${copy}`);
    return {
      copy: result.text
    };
  }
});

const logger$3 = new PinoLogger({ level: "info" });
logger$3.info("Initializing Publisher Agent...");
const memory$2 = createResearchMemory();
const publisherAgent = new Agent({
  id: "publisher-agent",
  name: "publisherAgent",
  description: "An agent that publishes blog posts by writing and editing content.",
  instructions: "You are a publisher agent that first calls the copywriter agent to write blog post copy about a specific topic and then calls the editor agent to edit the copy. Just return the final edited copy.",
  model: google("gemini-2.5-flash"),
  tools: {
    copywriterTool,
    editorTool,
    webSearchTool,
    evaluateResultTool,
    extractLearningsTool,
    "web-scraper": webScraperTool,
    batchWebScraperTool,
    siteMapExtractorTool,
    linkExtractorTool,
    htmlToMarkdownTool,
    contentCleanerTool
  },
  memory: memory$2
});
logger$3.info("Publish Agent is working!");

const logger$2 = new PinoLogger({ level: "info" });
logger$2.info("Initializing Copywriter Agent...");
const memory$1 = createResearchMemory();
const queryTool = createVectorQueryTool({
  vectorStoreName: "libsql",
  indexName: STORAGE_CONFIG.VECTOR_INDEXES.RESEARCH_DOCUMENTS,
  // Use research documents index
  model: google.textEmbedding("gemini-embedding-001"),
  enableFilter: true,
  description: "Search for semantically similar content in the LibSQL vector store using embeddings. Supports filtering, ranking, and context retrieval."
});
const copywriterAgent = new Agent({
  id: "copywriter-agent",
  name: "copywriter-agent",
  description: "An expert copywriter agent that writes engaging and high-quality blog post content on specified topics.",
  instructions: `You are a copywriter agent that writes blog post copy. Today is ${(/* @__PURE__ */ new Date()).toISOString()}. Please provide a concise and accurate response. Your goal is to write a blog post & similar tasks.
    - The blog post should be well-structured, informative, and engaging.
    - Use the provided tools to gather information and ensure factual accuracy.
    - Ensure the content is original and free from plagiarism.
    - Write in a clear, concise, and engaging style.
    - Maintain a consistent tone and voice throughout the content.

    Process queries using the provided context. Structure responses to be concise and relevant.
  ${LIBSQL_PROMPT}
  `,
  model: google("gemini-2.5-flash"),
  memory: memory$1,
  tools: {
    webScraperTool,
    queryTool,
    //    batchWebScraperTool,
    //   siteMapExtractorTool,
    //    linkExtractorTool,
    htmlToMarkdownTool
    //    contentCleanerTool
  }
});

const logger$1 = new PinoLogger({ level: "info" });
logger$1.info("Initializing Editor Agent...");
const memory = createResearchMemory();
const editorAgent = new Agent({
  id: "editor-agent",
  name: "Editor",
  description: "An editor agent that edits blog post copy to improve clarity, coherence, and overall quality.",
  instructions: "You are an editor agent that edits blog post copy.",
  model: google("gemini-2.5-flash-lite"),
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
    webSummarizationAgent,
    ragAgent,
    githubAgent,
    monitorAgent,
    planningAgent,
    qualityAssuranceAgent,
    publisherAgent,
    copywriterAgent,
    editorAgent,
    assistant
  },
  workflows: {
    generateReportWorkflow,
    researchWorkflow,
    comprehensiveResearchWorkflow,
    githubPlanningWorkflow,
    githubQualityWorkflow
  },
  vnext_networks: {
    complexResearchNetwork
  },
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
