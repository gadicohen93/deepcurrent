import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { LinkupClient } from 'linkup-sdk';
import 'dotenv/config';
import { PinoLogger } from "@mastra/loggers";

const logger = new PinoLogger({ level: 'info' });

// Initialize LinkUp client (will be re-initialized with proper API key in execute)
let linkup: LinkupClient | null = null;

export const linkupSearchTool = createTool({
  id: 'linkup-search',
  description: 'Search the web for information on a specific query using LinkUp and return summarized content',
  inputSchema: z.object({
    query: z.string().describe('The search query to run'),
  }),
  execute: async ({ context, mastra }) => {
    // Let Mastra automatically manage spans - don't create or end spans manually
    // Mastra's framework will handle span lifecycle automatically
    logger.info('Executing LinkUp search tool');
    const { query } = context;

    try {
      const apiKey = process.env.LINKUP_API_KEY;
      if (apiKey === undefined || apiKey === null || apiKey.trim() === '') {
        logger.error('Error: LINKUP_API_KEY not found in environment variables');
        return { results: [], error: 'Missing API key' };
      }

      // Initialize client with API key if not already initialized
      linkup ??= new LinkupClient({
        apiKey: apiKey ?? '',
      });

      logger.info(`Searching web with LinkUp for: "${query}"`);

      const data = await linkup.search({
        query,
        depth: 'standard', // Use standard for faster results
        outputType: 'searchResults',
      });

      const results = (data.results ?? []).slice(0, 3);

      if (!Array.isArray(results) || results.length === 0) {
        logger.info('No search results found');
        return { results: [], error: 'No results found' };
      }

      logger.info(`Found ${results.length} search results, summarizing content concurrently...`);

      // Get the summarization agent
      const summaryAgent = mastra!.getAgent('webSummarizationAgent');

      // Filter and prepare results for concurrent processing
      const textResults = results.filter((result): result is typeof result & { type: 'text' } => result.type === 'text');

      // Process short content synchronously (no summarization needed)
      const processedResults = textResults
        .filter(result => {
          const content = result.content ?? '';
          return content.length < 100;
        })
        .map(result => ({
          title: result.name ?? '',
          url: result.url,
          content: result.content ?? 'No content available',
        }));

      // Process results that need summarization concurrently
      const resultsToSummarize = textResults.filter(result => {
        const content = result.content ?? '';
        return content.length >= 100;
      });

      // Process all summarizations concurrently using Promise.all()
      const summarizationPromises = resultsToSummarize.map(async (result) => {
        try {
          const content = result.content ?? '';

          // Use generateVNext() for V2 models (gemini-2.5-flash-lite) as per Mastra issue #7042
          const summaryResponse = await summaryAgent.generateVNext([
            {
              role: 'user',
              content: `Please summarize the following web content for research query: "${query}"

Title: ${result.name ?? 'No title'}
URL: ${result.url}
Content: ${content.substring(0, 8000)}...

Provide a concise summary that captures the key information relevant to the research query.`,
            },
          ]);

          logger.info(`Summarized content for: ${result.name ?? result.url}`);

          return {
            title: result.name ?? '',
            url: result.url,
            content: summaryResponse.text,
          };
        } catch (summaryError) {
          logger.error('Error summarizing content', {
            error: summaryError instanceof Error ? summaryError.message : String(summaryError),
            stack: summaryError instanceof Error ? summaryError.stack : undefined,
            url: result.url,
          });
          // Fallback to truncated original content
          const fallbackContent = ((result.content?.substring(0, 500) ?? '') + '...') || 'Content unavailable';
          return {
            title: result.name ?? '',
            url: result.url,
            content: fallbackContent,
          };
        }
      });

      // Wait for all summarizations to complete concurrently
      const summarizedResults = await Promise.all(summarizationPromises);

      // Combine all results
      processedResults.push(...summarizedResults);

      logger.info('Processed results:', processedResults);
      return {
        results: processedResults,
      };
    } catch (error) {
      logger.error('Error searching the web with LinkUp', { error });
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error details:', { error: errorMessage });

      return {
        results: [],
        error: errorMessage,
      };
    }
  },
});

