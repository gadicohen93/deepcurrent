import { createTool } from '@mastra/core/tools';
import { RuntimeContext } from '@mastra/core/di';
import { AISpanType } from '@mastra/core/ai-tracing';
import { rerank } from '@mastra/rag';
import { vectorQueryTool } from './c73caf20-c312-42ec-bbbb-5c1ebb724d3d.mjs';
import { PinoLogger } from '@mastra/loggers';
import { z } from 'zod';
import { S as STORAGE_CONFIG } from '../libsql-storage.mjs';
import { google } from '@ai-sdk/google';
import 'ai';
import '@mastra/libsql';
import '@mastra/memory';
import '@mastra/core';

const logger = new PinoLogger({ name: "RerankTool", level: "info" });
const rerankInputSchema = z.object({
  indexName: z.string().optional().describe("Vector store index name (defaults to RESEARCH_DOCUMENTS)"),
  query: z.string().min(1).describe("Query string for semantic search and reranking"),
  topK: z.number().int().positive().default(10).describe("Number of initial results to retrieve before reranking"),
  finalK: z.number().int().positive().default(3).describe("Final number of results after reranking"),
  semanticWeight: z.number().min(0).max(1).default(0.6).describe("Weight for semantic similarity"),
  vectorWeight: z.number().min(0).max(1).default(0.3).describe("Weight for vector similarity"),
  positionWeight: z.number().min(0).max(1).default(0.1).describe("Weight for position bias")
}).strict();
const rerankOutputSchema = z.object({
  messages: z.array(z.any()).describe("Reranked core messages"),
  uiMessages: z.array(z.any()).describe("Reranked UI messages"),
  rerankMetadata: z.object({
    topK: z.number().describe("Initial number of results retrieved"),
    finalK: z.number().describe("Final number of results after reranking"),
    before: z.number().describe("Context messages before"),
    after: z.number().describe("Context messages after"),
    initialResultCount: z.number().describe("Total initial results before reranking"),
    rerankingUsed: z.boolean().describe("Whether reranking was applied"),
    rerankingDuration: z.number().describe("Time taken for reranking in milliseconds"),
    averageRelevanceScore: z.number().describe("Average relevance score of reranked results"),
    userId: z.string().optional(),
    sessionId: z.string().optional()
  }).describe("Metadata about the reranking process")
}).strict();
const rerankTool = createTool({
  id: "rerank",
  description: "Search and rerank conversation messages using semantic similarity and configurable weights",
  inputSchema: rerankInputSchema,
  outputSchema: rerankOutputSchema,
  execute: async ({ input, runtimeContext, tracingContext, memory }) => {
    const startTime = Date.now();
    try {
      const parsedInput = rerankInputSchema.parse(input);
      const userId = runtimeContext?.get("user-id") ?? "anonymous";
      const sessionId = runtimeContext?.get("session-id") ?? "default";
      const rawModelPreference = runtimeContext?.get("model-preference");
      const modelPreference = typeof rawModelPreference === "string" && rawModelPreference.length > 0 ? rawModelPreference : "gemini-2.5-flash-lite-preview-06-17";
      const rawSemanticWeight = runtimeContext?.get("semantic-weight");
      const semanticWeight = typeof rawSemanticWeight === "number" ? rawSemanticWeight : parsedInput.semanticWeight;
      const rawVectorWeight = runtimeContext?.get("vector-weight");
      const vectorWeight = typeof rawVectorWeight === "number" ? rawVectorWeight : parsedInput.vectorWeight;
      const rawPositionWeight = runtimeContext?.get("position-weight");
      const positionWeight = typeof rawPositionWeight === "number" ? rawPositionWeight : parsedInput.positionWeight;
      const rawDebug = runtimeContext?.get("debug");
      const debug = typeof rawDebug === "boolean" ? rawDebug : false;
      if (debug) {
        logger.info("Rerank tool executed with runtime context", {
          userId,
          sessionId,
          modelPreference,
          weights: { semanticWeight, vectorWeight, positionWeight },
          query: parsedInput.query,
          indexName: parsedInput.indexName
        });
      }
      let searchIndex = parsedInput.indexName ?? STORAGE_CONFIG.VECTOR_INDEXES.RESEARCH_DOCUMENTS;
      if (runtimeContext?.get("useReport")) {
        searchIndex = STORAGE_CONFIG.VECTOR_INDEXES.REPORTS;
      }
      const initialQuerySpan = tracingContext?.currentSpan ? tracingContext.currentSpan.createChildSpan({
        type: AISpanType.GENERIC,
        name: "rerank_initial_query",
        input: {
          query: parsedInput.query,
          indexName: searchIndex,
          topK: parsedInput.topK
        }
      }) : void 0;
      const initialResults = await vectorQueryTool.execute({
        context: {
          queryText: parsedInput.query,
          topK: parsedInput.topK,
          threadId: searchIndex
        },
        runtimeContext,
        tracingContext,
        memory
      });
      if (initialResults.results.length > parsedInput.finalK) {
        const model = google(modelPreference);
        if (initialQuerySpan) {
          initialQuerySpan.end({
            output: {
              resultsFound: initialResults.results.length,
              processingTime: Date.now() - startTime
            },
            metadata: { operation: "rerank_initial_query" }
          });
        }
        const queryResults = initialResults.results.map((result, index) => ({
          id: result.id,
          score: result.score,
          metadata: {
            ...result.metadata,
            text: result.content,
            index,
            userId,
            sessionId
          }
        }));
        const rerankedResults = await rerank(
          queryResults,
          parsedInput.query,
          model,
          {
            weights: {
              semantic: semanticWeight,
              vector: vectorWeight,
              position: positionWeight
            },
            topK: parsedInput.finalK
          }
        );
        const rerankedMessages = rerankedResults.map((result) => ({
          id: result.result.id,
          content: result.result.metadata?.text ?? "",
          role: "assistant",
          metadata: result.result.metadata,
          score: result.score
        }));
        const rerankMetadata = {
          topK: parsedInput.topK,
          finalK: parsedInput.finalK,
          before: 0,
          after: 0,
          initialResultCount: initialResults.results.length,
          rerankingUsed: true,
          rerankingDuration: Date.now() - startTime,
          averageRelevanceScore: rerankedResults.length > 0 ? rerankedResults.reduce((sum, r) => sum + r.score, 0) / rerankedResults.length : 0,
          userId,
          sessionId
        };
        const rerankSpan = tracingContext?.currentSpan ? tracingContext.currentSpan.createChildSpan({
          type: AISpanType.GENERIC,
          name: "rerank_operation",
          input: {
            initialCount: initialResults.results.length,
            finalK: parsedInput.finalK,
            model: modelPreference
          }
        }) : void 0;
        if (rerankSpan) {
          rerankSpan.end({
            output: {
              finalCount: rerankedResults.length,
              averageScore: rerankMetadata.averageRelevanceScore,
              processingTime: Date.now() - startTime
            },
            metadata: { operation: "rerank_operation" }
          });
        }
        if (debug) {
          logger.info("Reranked search completed", {
            originalCount: initialResults.results.length,
            finalCount: rerankedMessages.length,
            avgScore: rerankMetadata.averageRelevanceScore,
            duration: rerankMetadata.rerankingDuration
          });
        }
        return rerankOutputSchema.parse({
          messages: rerankedMessages,
          uiMessages: [],
          rerankMetadata
        });
      } else {
        const rerankMetadata = {
          topK: parsedInput.topK,
          finalK: parsedInput.finalK,
          before: 0,
          after: 0,
          initialResultCount: initialResults.results.length,
          rerankingUsed: false,
          rerankingDuration: Date.now() - startTime,
          averageRelevanceScore: 0,
          userId,
          sessionId
        };
        if (debug) {
          logger.info("Reranking skipped - insufficient results", {
            resultCount: initialResults.results.length,
            finalK: parsedInput.finalK
          });
        }
        return rerankOutputSchema.parse({
          messages: initialResults.results,
          uiMessages: [],
          rerankMetadata
        });
      }
    } catch (error) {
      logger.error("Rerank tool execution failed", {
        error: error instanceof Error ? error.message : String(error),
        query: input?.query,
        indexName: input?.indexName
      });
      const rerankMetadata = {
        topK: input?.topK || 10,
        finalK: input?.finalK || 3,
        before: 0,
        after: 0,
        initialResultCount: 0,
        rerankingUsed: false,
        rerankingDuration: Date.now() - startTime,
        averageRelevanceScore: 0,
        userId: runtimeContext?.get("user-id") ?? "anonymous",
        sessionId: runtimeContext?.get("session-id") ?? "default"
      };
      return rerankOutputSchema.parse({
        messages: [],
        uiMessages: [],
        rerankMetadata
      });
    }
  }
});
const rerankRuntimeContext = new RuntimeContext();
rerankRuntimeContext.set("model-preference", "gemini-2.5-flash-lite");
rerankRuntimeContext.set("semantic-weight", 0.6);
rerankRuntimeContext.set("vector-weight", 0.3);
rerankRuntimeContext.set("position-weight", 0.1);
rerankRuntimeContext.set("debug", false);
rerankRuntimeContext.set("quality-threshold", 0.7);

export { rerankRuntimeContext, rerankTool };
