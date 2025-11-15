import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { PinoLogger } from "@mastra/loggers";

const logger = new PinoLogger({ level: 'info' });

const evaluationResultSchema = z.object({
  result: z.object({
    title: z.string(),
    url: z.string(),
    content: z.string(),
  }),
  isRelevant: z.boolean(),
  reason: z.string(),
});

export const evaluateResultsBatchTool = createTool({
  id: 'evaluate-results-batch',
  description: 'Evaluate multiple search results in parallel to determine if they are relevant to the research query. This is faster than evaluating results one by one.',
  inputSchema: z.object({
    query: z.string().describe('The original research query'),
    results: z
      .array(
        z.object({
          title: z.string(),
          url: z.string(),
          content: z.string(),
        })
      )
      .describe('Array of search results to evaluate'),
    existingUrls: z.array(z.string()).describe('URLs that have already been processed').optional(),
  }),
  outputSchema: z.array(evaluationResultSchema),
  execute: async ({ context, mastra }) => {
    const { query, results, existingUrls = [] } = context;
    try {
      // Validate inputs
      if (!query || typeof query !== 'string') {
        throw new Error('Invalid query: query must be a non-empty string');
      }

      if (!Array.isArray(results)) {
        throw new Error('Invalid results: results must be an array');
      }

      if (results.length === 0) {
        logger.info('No results to evaluate, returning empty array');
        return [];
      }

      logger.info('Batch evaluating results', {
        query,
        resultCount: results.length,
        existingUrlsCount: existingUrls.length
      });

      // Ensure mastra is available at runtime
      if (!mastra) {
        const msg = 'Mastra instance is not available';
        logger.error(msg);
        return results.map(result => ({
          result,
          isRelevant: false,
          reason: 'Internal error: mastra not available',
        }));
      }

      const evaluationAgent = mastra.getAgent('evaluationAgent');

      if (!evaluationAgent) {
        const msg = 'Evaluation agent not found';
        logger.error(msg);
        return results.map(result => ({
          result,
          isRelevant: false,
          reason: 'Internal error: evaluation agent not available',
        }));
      }

      // Filter out already processed URLs and validate results
      const resultsToEvaluate = results.filter(result => {
        if (!result || typeof result !== 'object') {
          logger.warn('Invalid result object found, skipping', { result });
          return false;
        }
        if (!result.url || !result.title || !result.content) {
          logger.warn('Result missing required fields, skipping', { url: result.url });
          return false;
        }
        return !existingUrls.includes(result.url);
      });
      const skippedResults = results.filter(result => {
        if (!result || typeof result !== 'object' || !result.url) {
          return false;
        }
        return existingUrls.includes(result.url);
      });

      logger.info(`Evaluating ${resultsToEvaluate.length} results (skipping ${skippedResults.length} already processed)`);

      // Create evaluation promises for all results in parallel
      const evaluationPromises = resultsToEvaluate.map(async (result) => {
        try {
          logger.info('Calling evaluationAgent.generateVNext...', {
            query,
            title: result.title,
            url: result.url,
          });

          // Add timeout wrapper to prevent infinite hangs (30 seconds per result)
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Evaluation timeout after 30 seconds')), 30000);
          });

          // Use generateVNext() for V2 models (gemini-2.5-flash-lite) as per Mastra issue #7042
          const generatePromise = evaluationAgent.generateVNext(
            [
              {
                role: 'user',
                content: `Evaluate whether this search result is relevant and will help answer the query: "${query}".

        Search result:
        Title: ${result.title}
        URL: ${result.url}
        Content snippet: ${result.content.substring(0, 500)}...

        Respond with a JSON object containing:
        - isRelevant: boolean indicating if the result is relevant
        - reason: brief explanation of your decision`,
              },
            ],
            {
              output: z.object({
                isRelevant: z.boolean(),
                reason: z.string(),
              }),
            },
          );

          const response = await Promise.race([generatePromise, timeoutPromise]) as Awaited<typeof generatePromise>;

          return {
            result,
            isRelevant: response.object?.isRelevant ?? false,
            reason: response.object?.reason ?? 'No response from evaluation agent',
          };
        } catch (error) {
          logger.error('Error evaluating result:', {
            error: error instanceof Error ? error.message : String(error),
            url: result.url,
            stack: error instanceof Error ? error.stack : undefined,
          });
          return {
            result,
            isRelevant: false,
            reason: `Error in evaluation: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      });

      // Wait for all evaluations to complete in parallel
      const evaluationResults = await Promise.all(evaluationPromises);

      // Add skipped results with their evaluation
      const skippedEvaluations = skippedResults.map(result => ({
        result,
        isRelevant: false,
        reason: 'URL already processed',
      }));

      // Combine all results maintaining original order
      const allResults = [...evaluationResults, ...skippedEvaluations];

      // Sort to maintain original order of input results
      const resultMap = new Map(allResults.map(evaluation => [evaluation.result.url, evaluation]));
      const orderedResults = results.map(result => {
        const evaluation = resultMap.get(result.url);
        return evaluation ?? {
          result,
          isRelevant: false,
          reason: 'Evaluation result not found',
        };
      });

      logger.info('Batch evaluation completed', {
        totalResults: orderedResults.length,
        relevantCount: orderedResults.filter(r => r.isRelevant).length,
      });

      // Validate output against schema before returning
      const validatedResults = evaluationResultSchema.array().parse(orderedResults);
      return validatedResults;
    } catch (error) {
      logger.error('Error in batch evaluation:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        query,
        resultCount: results?.length ?? 0,
      });
      // Return error evaluations for all results, or empty array if results is invalid
      if (!Array.isArray(results) || results.length === 0) {
        return [];
      }
      return results.map(result => ({
        result,
        isRelevant: false,
        reason: `Batch evaluation error: ${error instanceof Error ? error.message : String(error)}`,
      }));
    }
  },
});

