/**
 * Enhanced LinkUp Search Tool - Strategy-Aware
 * 
 * Adapts search behavior based on runtime strategy configuration
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { LinkupClient } from 'linkup-sdk';
import 'dotenv/config';
import { PinoLogger } from "@mastra/loggers";

const logger = new PinoLogger({ level: 'info' });

let linkup: LinkupClient | null = null;

export const linkupSearchToolEnhanced = createTool({
  id: 'linkup-search-enhanced',
  description: 'Search the web using LinkUp with strategy-aware behavior',
  inputSchema: z.object({
    query: z.string().describe('The search query to run'),
  }),
  execute: async ({ context, mastra, runtimeContext }) => {
    logger.info('Executing Enhanced LinkUp search tool with strategy config');
    const { query } = context;

    // Access runtime strategy configuration
    const strategy = runtimeContext as any; // Type this properly in production
    const searchDepth = strategy?.searchDepth || 'standard';
    const timeWindow = strategy?.timeWindow || 'week';

    logger.info('Strategy config:', { searchDepth, timeWindow, query });

    try {
      const apiKey = process.env.LINKUP_API_KEY;
      if (!apiKey) {
        logger.error('Error: LINKUP_API_KEY not found');
        return { results: [], error: 'Missing API key' };
      }

      linkup ??= new LinkupClient({ apiKey });

      logger.info(`Searching web with LinkUp (${searchDepth} mode) for: "${query}"`);

      // Adapt search parameters based on strategy
      const depth = searchDepth === 'deep' ? 'deep' : 'standard';
      const resultCount = searchDepth === 'deep' ? 5 : searchDepth === 'shallow' ? 2 : 3;

      const data = await linkup.search({
        query,
        depth,
        outputType: 'searchResults',
      });

      const results = (data.results ?? []).slice(0, resultCount);

      if (!Array.isArray(results) || results.length === 0) {
        logger.info('No search results found');
        return { results: [], error: 'No results found' };
      }

      logger.info(`Found ${results.length} search results (${searchDepth} mode), summarizing...`);

      // Get the summarization agent
      const summaryAgent = mastra!.getAgent('webSummarizationAgent');

      // Filter and prepare results
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

      const summarizationPromises = resultsToSummarize.map(async (result) => {
        try {
          const content = result.content ?? '';

          // Adapt summarization based on search depth
          const maxChars = searchDepth === 'shallow' ? 4000 : 8000;
          
          const summaryResponse = await summaryAgent.generateVNext([
            {
              role: 'user',
              content: `Please summarize the following web content for research query: "${query}"

Title: ${result.name ?? 'No title'}
URL: ${result.url}
Content: ${content.substring(0, maxChars)}...

Provide a ${searchDepth === 'shallow' ? 'brief' : 'concise'} summary that captures the key information.`,
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
          const fallbackContent = ((result.content?.substring(0, 500) ?? '') + '...') || 'Content unavailable';
          return {
            title: result.name ?? '',
            url: result.url,
            content: fallbackContent,
          };
        }
      });

      const summarizedResults = await Promise.all(summarizationPromises);
      processedResults.push(...summarizedResults);

      logger.info(`Processed ${processedResults.length} results using ${searchDepth} strategy`);
      
      return {
        results: processedResults,
        strategyApplied: {
          searchDepth,
          resultCount,
        },
      };
    } catch (error) {
      logger.error('Error searching the web with LinkUp', { error });
      logger.error('Error details:', { error: error instanceof Error ? error.message : String(error) });
      return {
        results: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
});

