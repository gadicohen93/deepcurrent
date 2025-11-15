import { createTool } from '@mastra/core/tools';
import { MDocument } from '@mastra/rag';
import { z } from 'zod';
import { generateId, embedMany } from 'ai';
import { PinoLogger } from '@mastra/loggers';
import { RuntimeContext } from '@mastra/core/runtime-context';
import { AISpanType } from '@mastra/core/ai-tracing';
import { S as STORAGE_CONFIG, e as extractChunkMetadata, u as upsertVectors } from '../libsql-storage.mjs';
import { google } from '@ai-sdk/google';
import '@mastra/libsql';
import '@mastra/memory';
import '@mastra/core';

const logger = new PinoLogger({ name: "ChunkerTool", level: "info" });
const chunkingStrategySchema = z.enum(["recursive", "sentence", "paragraph", "fixed", "semantic"]).describe("Strategy for chunking documents");
const chunkParamsSchema = z.object({
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
const documentInputSchema = z.object({
  content: z.string().min(1).describe("The document content to process"),
  type: documentTypeSchema.default("text").describe("Type of document content"),
  title: z.string().optional().describe("Optional document title"),
  source: z.string().optional().describe("Source URL or file path"),
  metadata: documentMetadataSchema.optional()
}).strict();
const chunkerInputSchema = z.object({
  document: documentInputSchema,
  chunkParams: chunkParamsSchema.optional().describe("Parameters for document chunking"),
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
      logger.info("Document chunker input validated", {
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
        logger.info("Starting metadata extraction for chunks", {
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
        logger.info("Metadata extraction completed", {
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
        logger.info("Starting vector processing for chunks", {
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
          logger.info("Upserting to vector store", {
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
            logger.error("Failed to upsert vectors during chunking", {
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
        logger.info("Vector processing completed", vectorStats);
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
      logger.info("Document chunking completed successfully", {
        totalChunks: result.chunks.length,
        strategy: chunkConfig.strategy,
        processingTime: result.stats.processingTime,
        avgChunkSize: result.stats.avgChunkSize
      });
      return chunkerOutputSchema.parse(result);
    } catch (error) {
      logger.error("Document chunking failed", {
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

export { chunkerRuntimeContext, chunkerTool };
