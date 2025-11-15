import { LibSQLVector, LibSQLStore } from '@mastra/libsql';
import { Memory } from '@mastra/memory';
import { embedMany } from 'ai';
import { PinoLogger } from '@mastra/loggers';
import { AISpanType } from '@mastra/core/ai-tracing';
import { MemoryProcessor } from '@mastra/core';
import { google } from '@ai-sdk/google';

const logger$1 = new PinoLogger({ level: "info" });
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
        logger$1.info("Token limit reached, stopping retrieval");
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
        logger$1.warn("Duplicate research content skipped");
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
          logger$1.debug(`Retained cached semantic message (relevance: ${cachedRelevance})`);
          return true;
        } else {
          logger$1.debug(`Filtered cached episodic message (relevance: ${cachedRelevance})`);
          return false;
        }
      }
      const relevance = Math.min(1, length / 1e3);
      similarityCache.set(cacheKey, relevance);
      if (relevance >= this.threshold) {
        logger$1.debug(`Retained semantic message (relevance: ${relevance})`);
        return true;
      } else {
        logger$1.debug(`Filtered episodic message (relevance: ${relevance})`);
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
        logger$1.debug("Retained personalized research message");
        result.push(msg);
      } else {
        logger$1.debug("Filtered non-personalized message");
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
        logger$1.debug("Retained message with citation");
        result.push(msg);
      } else {
        logger$1.debug("Filtered message without citation");
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
          logger$1.debug("Retained cached multi-perspective research message");
          result.push(msg);
        } else {
          logger$1.debug("Filtered cached single-perspective message");
        }
        continue;
      }
      const multiPerspective = this.viewpoints.some((view) => content.includes(view)) || CODE_PATTERN.test(rawContent);
      patternCache.set(cacheKey, multiPerspective);
      if (multiPerspective) {
        logger$1.debug("Retained multi-perspective research message");
        result.push(msg);
      } else {
        logger$1.debug("Filtered single-perspective message");
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
        logger$1.debug("Retained temporal reasoning research message");
        result.push(msg);
      } else {
        logger$1.debug("Filtered non-temporal message");
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
        logger$1.debug("Retained uncertainty quantification research message");
        result.push(msg);
      } else {
        logger$1.debug("Filtered message without uncertainty quantification");
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
        logger$1.debug("Retained knowledge graph research message");
        result.push(msg);
      } else {
        logger$1.debug("Filtered non-graph message");
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
        logger$1.debug("Retained Bayesian belief research message");
        result.push(msg);
      } else {
        logger$1.debug("Filtered non-Bayesian message");
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
        logger$1.info("Circuit breaker attempting recovery");
      } else {
        logger$1.warn("Circuit breaker is open, skipping processing");
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
          logger$1.debug("Retained reliable research message");
          result.push(msg);
        } else {
          logger$1.debug("Filtered unreliable message");
        }
      }
      this.failureCount = 0;
      return result;
    } catch (error) {
      this.failureCount++;
      this.lastFailureTime = Date.now();
      if (this.failureCount >= this.failureThreshold) {
        this.isOpen = true;
        logger$1.error(`Circuit breaker opened after ${this.failureCount} failures`);
      }
      logger$1.error("Circuit breaker caught error in processing", {
        error: error instanceof Error ? error.message : "Unknown error",
        failureCount: this.failureCount
      });
      return messages;
    }
  }
}

const logger = new PinoLogger({
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
    logger.info("LibSQL storage initialized successfully", {
      databaseUrl: databaseUrl.replace(/authToken=[^&]*/, "authToken=***"),
      processingTime
    });
    return store;
  } catch (error) {
    const processingTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("Failed to initialize LibSQL storage", {
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
  const initSpan = tracingContext?.currentSpan?.createChildSpan({
    type: AISpanType.GENERIC,
    name: "libsql_vector_store_initialization",
    input: {
      databaseUrl: databaseUrl.replace(/authToken=[^&]*/, "authToken=***"),
      // Mask auth token
      hasAuthToken: !!(process.env.VECTOR_DATABASE_AUTH_TOKEN ?? process.env.DATABASE_AUTH_TOKEN)
    }
  });
  try {
    const vectorStore = new LibSQLVector({
      connectionUrl: databaseUrl,
      authToken: process.env.VECTOR_DATABASE_AUTH_TOKEN ?? process.env.DATABASE_AUTH_TOKEN
    });
    const processingTime = Date.now() - startTime;
    initSpan?.end({
      output: {
        success: true,
        processingTime
      },
      metadata: {
        databaseUrl: databaseUrl.replace(/authToken=[^&]*/, "authToken=***"),
        operation: "vector_store_initialization"
      }
    });
    logger.info("LibSQL vector store initialized successfully", {
      databaseUrl: databaseUrl.replace(/authToken=[^&]*/, "authToken=***"),
      processingTime
    });
    return vectorStore;
  } catch (error) {
    const processingTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    initSpan?.end({
      output: {
        success: false,
        processingTime
      },
      metadata: {
        error: errorMessage,
        operation: "vector_store_initialization"
      }
    });
    logger.error("Failed to initialize LibSQL vector store", {
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
      new CitationExtractorProcessor({ component: logger, name: "citation-extractor" }),
      new ErrorCorrectionProcessor({ component: logger, name: "error-correction" }),
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
    const vectorStore = createLibSQLVectorStore(tracingContext);
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
    logger.info("Vectors upserted successfully", {
      indexName,
      count: vectors.length,
      processingTime
    });
    return { success: true, count: vectors.length };
  } catch (error) {
    const processingTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("Failed to upsert vectors", {
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
    const vectorStore = createLibSQLVectorStore(tracingContext);
    await vectorStore.createIndex({
      indexName,
      dimension,
      metric
    });
    const processingTime = Date.now() - startTime;
    logger.info("Vector index created successfully", { indexName, dimension, metric, processingTime });
    return { success: true };
  } catch (error) {
    const processingTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("Failed to create vector index", {
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
    logger.info("Memory search completed", {
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
    logger.error("Failed to search memory messages", {
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
  logger.info("Metadata extraction completed", {
    chunksProcessed: chunks.length,
    extractParams: Object.keys(extractParams)
  });
  return enhancedChunks;
}

export { STORAGE_CONFIG as S, VectorStoreError as V, createLibSQLVectorStore as a, createResearchMemory as b, createVectorIndex as c, extractChunkMetadata as e, searchMemoryMessages as s, upsertVectors as u };
