import { createVectorQueryTool } from '@mastra/rag';
import { createTool } from '@mastra/core/tools';
import { RuntimeContext } from '@mastra/core/di';
import { AISpanType } from '@mastra/core/ai-tracing';
import { z } from 'zod';
import { S as STORAGE_CONFIG, s as searchMemoryMessages, a as createLibSQLVectorStore } from '../libsql-storage.mjs';
import { PinoLogger } from '@mastra/loggers';
import { generateId, embedMany } from 'ai';
import { google } from '@ai-sdk/google';
import '@mastra/libsql';
import '@mastra/memory';
import '@mastra/core';

const logger = new PinoLogger({ name: "VectorQueryTool", level: "info" });
const vectorQueryInputSchema = z.object({
  query: z.string().min(1).describe("The query to search for in the vector store"),
  threadId: z.string().optional().describe("Optional thread ID to search within a specific conversation thread"),
  topK: z.number().int().positive().default(5).describe("Number of most similar results to return"),
  minScore: z.number().min(0).max(1).default(0).describe("Minimum similarity score threshold"),
  before: z.number().int().min(0).default(2).describe("Number of messages before each match to include for context"),
  after: z.number().int().min(0).default(1).describe("Number of messages after each match to include for context"),
  includeMetadata: z.boolean().default(true).describe("Whether to include metadata in results"),
  enableFilter: z.boolean().default(false).describe("Enable filtering based on metadata"),
  filter: z.record(z.string(), z.any()).optional().describe("Optional metadata filter using Pinecone-compatible MongoDB/Sift query syntax. Supports: $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $and, $or, $not, $nor, $exists. Field keys limited to 512 chars, no null values.")
}).strict();
const vectorQueryResultSchema = z.object({
  id: z.string().describe("Unique identifier for the result"),
  content: z.string().describe("The text content of the chunk"),
  score: z.number().describe("Similarity score (0-1)"),
  metadata: z.record(z.string(), z.any()).optional().describe("Chunk metadata including position, type, etc."),
  threadId: z.string().optional().describe("Thread ID if applicable")
});
const vectorQueryOutputSchema = z.object({
  relevantContext: z.string().describe("Combined text from the most relevant chunks"),
  results: z.array(vectorQueryResultSchema).describe("Array of search results with similarity scores"),
  totalResults: z.number().int().min(0).describe("Total number of results found"),
  processingTime: z.number().min(0).describe("Time taken to process the query in milliseconds"),
  queryEmbedding: z.array(z.number()).optional().describe("The embedding vector of the query")
}).strict();
const vectorQueryTool = createVectorQueryTool({
  vectorStoreName: "libsql",
  // Use LibSQL vector store
  indexName: STORAGE_CONFIG.VECTOR_INDEXES.RESEARCH_DOCUMENTS,
  // Use research documents index
  model: google.textEmbedding("gemini-embedding-001"),
  // Use Gemini embedding model
  databaseConfig: {
    libsql: {
      connectionUrl: process.env.VECTOR_DATABASE_URL ?? STORAGE_CONFIG.VECTOR_DATABASE_URL,
      authToken: process.env.VECTOR_DATABASE_AUTH_TOKEN ?? process.env.DATABASE_AUTH_TOKEN
    }
  },
  enableFilter: true,
  description: "Search for semantically similar content in the LibSQL vector store using embeddings. Supports filtering, ranking, and context retrieval."
});
const enhancedVectorQueryTool = createTool({
  id: "vector_query",
  description: "Advanced vector search with hybrid filtering, metadata search, and agent memory integration",
  inputSchema: vectorQueryInputSchema,
  outputSchema: vectorQueryOutputSchema,
  execute: async ({ input, runtimeContext, tracingContext, memory }) => {
    const startTime = Date.now();
    try {
      const validatedInput = vectorQueryInputSchema.parse(input);
      const userId = runtimeContext?.get("user-id") ?? "anonymous";
      const sessionId = runtimeContext?.get("session-id") ?? "default";
      const searchPreference = runtimeContext?.get("search-preference") ?? "semantic";
      const rawQualityThreshold = runtimeContext?.get("quality-threshold");
      const qualityThreshold = typeof rawQualityThreshold === "number" ? rawQualityThreshold : Number(rawQualityThreshold ?? validatedInput.minScore) || validatedInput.minScore;
      const debug = runtimeContext?.get("debug") ?? false;
      if (tracingContext?.currentSpan) {
        tracingContext.currentSpan.update({
          metadata: {
            operation: "vector_query",
            query: validatedInput.query,
            userId,
            sessionId,
            searchPreference,
            qualityThreshold: Number(qualityThreshold),
            topK: validatedInput.topK,
            threadId: validatedInput.threadId,
            enableFilter: validatedInput.enableFilter,
            hasMemory: !!memory
          }
        });
      }
      if (debug) {
        logger.info("Vector query input validated", {
          query: validatedInput.query,
          userId,
          sessionId,
          searchPreference,
          qualityThreshold: Number(qualityThreshold)
        });
      }
      if (tracingContext?.currentSpan) {
        tracingContext.currentSpan.attributes = {
          ...tracingContext.currentSpan.attributes,
          "vector.operation": "query"
        };
      }
      const results = [];
      let relevantContext = "";
      if (typeof validatedInput.threadId === "string" && validatedInput.threadId.length > 0) {
        const threadId = validatedInput.threadId;
        logger.info("Searching within thread using LibSQL memory", { threadId });
        if (!memory) {
          throw new Error("Memory instance is required for thread-specific searches.");
        }
        const recallParams = runtimeContext?.get("useReport") ? { topK: 10, messageRange: 3, scope: "resource" } : { topK: 5, messageRange: 2, scope: "thread" };
        const memorySearchSpan = tracingContext?.currentSpan?.createChildSpan({
          type: AISpanType.GENERIC,
          name: "memory_search",
          input: {
            threadId,
            query: validatedInput.query,
            topK: validatedInput.topK,
            recallParams
          }
        });
        const { messages, uiMessages } = await searchMemoryMessages(
          memory,
          threadId,
          validatedInput.query,
          validatedInput.topK
        );
        memorySearchSpan?.end({
          output: {
            messagesFound: messages.length,
            uiMessagesFound: uiMessages.length
          },
          metadata: {
            threadId,
            totalResults: messages.length + uiMessages.length
          }
        });
        messages.forEach((message) => {
          results.push({
            id: message.id ?? generateId(),
            content: message.content ?? "",
            score: 1,
            // searchMemoryMessages doesn't return score, assume perfect match
            metadata: {
              role: message.role,
              threadId,
              createdAt: message.createdAt
              // Add other relevant metadata from message if available
            },
            threadId
          });
        });
        uiMessages.forEach((uiMessage) => {
          const anyUi = uiMessage;
          const uiContent = typeof anyUi.content === "string" ? anyUi.content : typeof anyUi.text === "string" ? anyUi.text : JSON.stringify(anyUi);
          results.push({
            id: uiMessage.id ?? generateId(),
            content: uiContent,
            score: 1,
            // searchMemoryMessages doesn't return score, assume perfect match
            metadata: {
              role: uiMessage.role,
              threadId
              // Add other relevant metadata from uiMessage if available
            },
            threadId
          });
        });
        relevantContext = [...messages, ...uiMessages].map((m) => typeof m.content === "string" ? m.content : typeof m.text === "string" ? m.text : "").join("\n\n");
      } else {
        logger.info("Performing direct LibSQL vector store search");
        const embeddingSpan = tracingContext?.currentSpan?.createChildSpan({
          type: AISpanType.GENERIC,
          name: "embedding_generation",
          input: {
            query: validatedInput.query,
            model: "gemini-embedding-001"
          }
        });
        const { embeddings } = await embedMany({
          model: google.textEmbedding("gemini-embedding-001"),
          values: [validatedInput.query]
        });
        const queryEmbedding = embeddings[0];
        embeddingSpan?.end({
          output: {
            embeddingDimension: queryEmbedding.length
          },
          metadata: {
            model: "gemini-embedding-001",
            tokensProcessed: validatedInput.query.split(/\s+/).filter(Boolean).length
          }
        });
        const vectorQuerySpan = tracingContext?.currentSpan?.createChildSpan({
          type: AISpanType.GENERIC,
          name: "vector_store_query",
          input: {
            indexName: STORAGE_CONFIG.VECTOR_INDEXES.RESEARCH_DOCUMENTS,
            topK: validatedInput.topK,
            enableFilter: validatedInput.enableFilter,
            queryVectorLength: queryEmbedding.length
          }
        });
        let searchIndex = STORAGE_CONFIG.VECTOR_INDEXES.RESEARCH_DOCUMENTS;
        if (runtimeContext?.get("useReport")) {
          searchIndex = STORAGE_CONFIG.VECTOR_INDEXES.REPORTS;
        }
        const vectorStore = createLibSQLVectorStore(tracingContext);
        const vectorResults = await vectorStore.query({
          indexName: searchIndex,
          queryVector: queryEmbedding,
          topK: validatedInput.topK,
          filter: validatedInput.enableFilter ? validatedInput.filter : void 0,
          includeVector: false
          // Don't include vectors in response for performance
        });
        vectorQuerySpan?.end({
          output: {
            resultsFound: vectorResults.length
          },
          metadata: {
            indexName: STORAGE_CONFIG.VECTOR_INDEXES.RESEARCH_DOCUMENTS,
            topK: validatedInput.topK,
            filterApplied: validatedInput.enableFilter
          }
        });
        vectorResults.forEach((result, index) => {
          const content = String(Boolean(result.metadata?.text ?? result.metadata?.content) || "");
          const score = result.score ?? 0;
          const newLocal = score >= qualityThreshold;
          if (newLocal) {
            results.push({
              id: result.id ?? `vec-${index}`,
              content,
              score,
              metadata: {
                ...result.metadata ?? {},
                userId,
                sessionId,
                searchPreference
              }
            });
          }
        });
        relevantContext = results.map((r) => r.content).join("\n\n");
      }
      const processingTime = Date.now() - startTime;
      const output = {
        relevantContext,
        results,
        totalResults: results.length,
        processingTime,
        queryEmbedding: void 0
        // Don't include embeddings by default for performance
      };
      if (tracingContext?.currentSpan) {
        tracingContext.currentSpan.update({
          metadata: {
            ...tracingContext.currentSpan.metadata,
            totalResults: output.totalResults,
            processingTime: output.processingTime,
            success: true,
            operationCompleted: true
          }
        });
      }
      logger.info("Vector query completed successfully", {
        totalResults: output.totalResults,
        processingTime: output.processingTime,
        threadId: validatedInput.threadId,
        userId,
        sessionId
      });
      return vectorQueryOutputSchema.parse(output);
    } catch (error) {
      logger.error("Vector query failed", {
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error(`Vector query failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
});
const hybridScoreSchema = z.object({
  semanticScore: z.number().describe("Pure semantic similarity score"),
  metadataScore: z.number().describe("Metadata matching score"),
  combinedScore: z.number().describe("Weighted combination of both scores")
});
const hybridInputSchema = vectorQueryInputSchema.extend({
  metadataQuery: z.record(z.string(), z.any()).describe("Chunk metadata including position, type, etc."),
  semanticWeight: z.number().min(0).max(1).default(0.7).describe("Weight for semantic similarity (0-1)"),
  metadataWeight: z.number().min(0).max(1).default(0.3).describe("Weight for metadata matching (0-1)")
});
const hybridOutputSchema = vectorQueryOutputSchema.extend({
  hybridScores: z.array(hybridScoreSchema).describe("Breakdown of hybrid scoring")
});
const hybridVectorSearchTool = createTool({
  id: "hybrid_vector_query",
  description: "Hybrid search combining vector similarity with metadata filtering for precise results",
  inputSchema: hybridInputSchema,
  outputSchema: hybridOutputSchema,
  execute: async ({
    input,
    runtimeContext,
    tracingContext,
    // Add tracingContext
    memory
    // Pass memory
  }) => {
    if (tracingContext?.currentSpan) {
      tracingContext.currentSpan.attributes = {
        ...tracingContext.currentSpan.attributes,
        "vector.operation": "hybrid-search"
      };
    }
    const startTime = Date.now();
    try {
      const extendedSchema = vectorQueryInputSchema.extend({
        metadataQuery: z.record(z.string(), z.any()).optional(),
        semanticWeight: z.number().min(0).max(1).default(0.7),
        metadataWeight: z.number().min(0).max(1).default(0.3)
      });
      const validatedInput = extendedSchema.parse(input);
      const userId = runtimeContext?.get("user-id") ?? "anonymous";
      const sessionId = runtimeContext?.get("session-id") ?? "default";
      const searchPreference = runtimeContext?.get("search-preference") ?? "hybrid";
      logger.info("Hybrid vector search initiated", {
        query: validatedInput.query,
        semanticWeight: validatedInput.semanticWeight,
        metadataWeight: validatedInput.metadataWeight,
        userId,
        sessionId,
        searchPreference
      });
      logger.info("Using enhanced vector query for semantic search");
      const basicResults = await enhancedVectorQueryTool.execute({
        input: {
          query: validatedInput.query,
          topK: validatedInput.topK,
          minScore: validatedInput.minScore,
          before: 2,
          after: 1,
          includeMetadata: true,
          enableFilter: validatedInput.enableFilter || false,
          filter: validatedInput.filter
        },
        context: {
          // Re-add context object as it's required by ToolExecutionContext
          query: validatedInput.query,
          topK: validatedInput.topK,
          minScore: validatedInput.minScore,
          before: 2,
          after: 1,
          includeMetadata: true,
          enableFilter: validatedInput.enableFilter || false,
          filter: validatedInput.filter
        },
        runtimeContext,
        tracingContext: runtimeContext?.get("tracingContext"),
        // Pass tracingContext
        memory
        // Pass memory to enhancedVectorQueryTool
      });
      const semanticResults = {
        relevantContext: basicResults.relevantContext || "",
        results: basicResults.results.map((r) => ({
          id: r.id,
          content: r.content,
          score: r.score,
          metadata: r.metadata
        })),
        totalResults: basicResults.totalResults,
        processingTime: 0
      };
      const hybridScores = [];
      if (validatedInput.metadataQuery) {
        semanticResults.results.forEach((result) => {
          const semanticScore = result.score;
          let metadataScore = 0;
          if (result.metadata && validatedInput.metadataQuery) {
            const matchingKeys = Object.keys(validatedInput.metadataQuery).filter(
              (key) => result.metadata?.[key] === validatedInput.metadataQuery?.[key]
            );
            metadataScore = matchingKeys.length / Object.keys(validatedInput.metadataQuery).length;
          }
          const combinedScore = semanticScore * validatedInput.semanticWeight + metadataScore * validatedInput.metadataWeight;
          hybridScores.push({
            semanticScore,
            metadataScore,
            combinedScore
          });
        });
        const resultsWithScores = semanticResults.results.map((result, index) => {
          const safeMetadata = {};
          if (result.metadata && typeof result.metadata === "object") {
            for (const key of Object.keys(result.metadata)) {
              if (typeof key === "string" && !Object.prototype.hasOwnProperty.call(Object.prototype, key)) {
                safeMetadata[key] = result.metadata[key];
              }
            }
          }
          return {
            ...result,
            score: hybridScores[index].combinedScore,
            metadata: {
              ...safeMetadata,
              userId,
              sessionId,
              searchPreference
            }
          };
        });
        resultsWithScores.sort((a, b) => b.score - a.score);
        semanticResults.results = resultsWithScores;
      }
      const processingTime = Date.now() - startTime;
      const output = {
        ...semanticResults,
        processingTime,
        hybridScores
      };
      logger.info("Hybrid vector search completed", {
        totalResults: output.totalResults,
        processingTime,
        hasMetadataQuery: !!validatedInput.metadataQuery,
        userId,
        sessionId
      });
      return output;
    } catch (error) {
      logger.error("Hybrid vector search failed", {
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error(`Hybrid vector search failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
});
const vectorQueryRuntimeContext = new RuntimeContext();
vectorQueryRuntimeContext.set("user-id", "anonymous");
vectorQueryRuntimeContext.set("session-id", "default");
vectorQueryRuntimeContext.set("search-preference", "semantic");
vectorQueryRuntimeContext.set("language", "en");
vectorQueryRuntimeContext.set("quality-threshold", 0.5);

export { enhancedVectorQueryTool, hybridVectorSearchTool, vectorQueryRuntimeContext, vectorQueryTool };
