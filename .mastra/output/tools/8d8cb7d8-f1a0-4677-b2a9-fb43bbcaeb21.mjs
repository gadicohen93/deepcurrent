import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { LinkupClient } from 'linkup-sdk';
import { PinoLogger } from '@mastra/loggers';

const logger = new PinoLogger({ level: "info" });
let linkup = null;
const linkupSearchTool = createTool({
  id: "linkup-search",
  description: "Search the web for information on a specific query using LinkUp and return summarized content",
  inputSchema: z.object({
    query: z.string().describe("The search query to run")
  }),
  execute: async ({ context, mastra }) => {
    logger.info("Executing LinkUp search tool");
    const { query } = context;
    try {
      const apiKey = process.env.LINKUP_API_KEY;
      if (apiKey === void 0 || apiKey === null || apiKey.trim() === "") {
        logger.error("Error: LINKUP_API_KEY not found in environment variables");
        return { results: [], error: "Missing API key" };
      }
      linkup ??= new LinkupClient({
        apiKey: apiKey ?? ""
      });
      logger.info(`Searching web with LinkUp for: "${query}"`);
      const data = await linkup.search({
        query,
        depth: "standard",
        // Use standard for faster results
        outputType: "searchResults"
      });
      const results = (data.results ?? []).slice(0, 3);
      if (!Array.isArray(results) || results.length === 0) {
        logger.info("No search results found");
        return { results: [], error: "No results found" };
      }
      logger.info(`Found ${results.length} search results, summarizing content concurrently...`);
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
          logger.info(`Summarized content for: ${result.name ?? result.url}`);
          return {
            title: result.name ?? "",
            url: result.url,
            content: summaryResponse.text
          };
        } catch (summaryError) {
          logger.error("Error summarizing content", {
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
      logger.info("Processed results:", processedResults);
      return {
        results: processedResults
      };
    } catch (error) {
      logger.error("Error searching the web with LinkUp", { error });
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error("Error details:", { error: errorMessage });
      return {
        results: [],
        error: errorMessage
      };
    }
  }
});

export { linkupSearchTool };
