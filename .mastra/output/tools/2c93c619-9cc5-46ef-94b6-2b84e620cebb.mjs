import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import Exa from 'exa-js';
import { PinoLogger } from '@mastra/loggers';

const logger = new PinoLogger({ level: "info" });
const exa = new Exa(process.env.EXA_API_KEY);
const webSearchTool = createTool({
  id: "web-search",
  description: "Search the web for information on a specific query and return summarized content",
  inputSchema: z.object({
    query: z.string().describe("The search query to run")
  }),
  execute: async ({ context, mastra }) => {
    logger.info("Executing web search tool");
    const { query } = context;
    try {
      const apiKey = process.env.EXA_API_KEY;
      if (apiKey === void 0 || apiKey === null || apiKey.trim() === "") {
        logger.error("Error: EXA_API_KEY not found in environment variables");
        return { results: [], error: "Missing API key" };
      }
      logger.info(`Searching web for: "${query}"`);
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
        logger.info("No search results found");
        return { results: [], error: "No results found" };
      }
      logger.info(`Found ${results.length} search results, summarizing content...`);
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
          logger.info(`Summarized content for: ${result.title ?? result.url}`);
        } catch (summaryError) {
          logger.error("Error summarizing content", {
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
      logger.error("Error searching the web", { error });
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error("Error details:", { error: errorMessage });
      return {
        results: [],
        error: errorMessage
      };
    }
  }
});

export { webSearchTool };
