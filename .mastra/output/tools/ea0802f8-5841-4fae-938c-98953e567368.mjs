import { createTool } from '@mastra/core/tools';
import { createGraphRAGTool } from '@mastra/rag';
import { z } from 'zod';
import { embedMany, generateId } from 'ai';
import { PinoLogger } from '@mastra/loggers';
import { RuntimeContext } from '@mastra/core/runtime-context';
import { AISpanType } from '@mastra/core/ai-tracing';
import { S as STORAGE_CONFIG, c as createVectorIndex, u as upsertVectors, V as VectorStoreError, s as searchMemoryMessages } from '../libsql-storage.mjs';
import { chunkerTool } from './d8015496-852c-4ce0-88b2-f85db90c53ec.mjs';
import { google } from '@ai-sdk/google';
import '@mastra/libsql';
import '@mastra/memory';
import '@mastra/core';

const logger = new PinoLogger({ name: "GraphRAGTool" });
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
        logger.info("Starting document upsert", {
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
      logger.info("Document chunked successfully", { totalChunks: chunks.length });
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
          logger.warn("Index validation warning (may already exist)", {
            indexName: validatedInput.indexName,
            error: idxResult.error
          });
        } else {
          logger.info("Upstash vector index validated", { indexName: validatedInput.indexName });
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
      logger.info("Document upsert completed successfully", result);
      return upsertOutputSchema.parse(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Document upsert failed", {
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
        logger.info("Starting GraphRAG query", {
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
      logger.info("GraphRAG query completed successfully", {
        relevantContextLength: result.relevantContext.length,
        totalResults: result.totalResults,
        avgScore: result.graphStats.avgScore,
        processingTime: result.processingTime
      });
      return queryOutputSchema.parse(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("GraphRAG query failed", {
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

export { graphRAGQueryTool, graphRAGRuntimeContext, graphRAGTool, graphRAGUpsertTool };
