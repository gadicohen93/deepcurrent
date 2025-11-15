import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { PinoLogger } from '@mastra/loggers';

const logger = new PinoLogger({ level: "info" });
const evaluateResultTool = createTool({
  id: "evaluate-result",
  description: "Evaluate if a search result is relevant to the research query",
  inputSchema: z.object({
    query: z.string().describe("The original research query"),
    result: z.object({
      title: z.string(),
      url: z.string(),
      content: z.string()
    }).describe("The search result to evaluate"),
    existingUrls: z.array(z.string()).describe("URLs that have already been processed").optional()
  }),
  execute: async ({ context, mastra }) => {
    try {
      const { query, result, existingUrls = [] } = context;
      logger.info("Evaluating result", { context });
      if (existingUrls?.includes(result.url)) {
        return {
          isRelevant: false,
          reason: "URL already processed"
        };
      }
      if (!mastra) {
        const msg = "Mastra instance is not available";
        logger.error(msg);
        return {
          isRelevant: false,
          reason: "Internal error: mastra not available"
        };
      }
      const evaluationAgent = mastra.getAgent("evaluationAgent");
      if (!evaluationAgent) {
        const msg = "Evaluation agent not found";
        logger.error(msg);
        return {
          isRelevant: false,
          reason: "Internal error: evaluation agent not available"
        };
      }
      logger.info("Calling evaluationAgent.generateVNext...", {
        query,
        title: result.title,
        url: result.url
      });
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Evaluation timeout after 30 seconds")), 3e4);
      });
      const generatePromise = evaluationAgent.generateVNext(
        [
          {
            role: "user",
            content: `Evaluate whether this search result is relevant and will help answer the query: "${query}".

        Search result:
        Title: ${result.title}
        URL: ${result.url}
        Content snippet: ${result.content.substring(0, 500)}...

        Respond with a JSON object containing:
        - isRelevant: boolean indicating if the result is relevant
        - reason: brief explanation of your decision`
          }
        ],
        {
          output: z.object({
            isRelevant: z.boolean(),
            reason: z.string()
          })
        }
      );
      logger.info("Waiting for generateVNext response...");
      const response = await Promise.race([generatePromise, timeoutPromise]);
      logger.info("Received generateVNext response", { hasObject: response.object !== void 0 });
      return response.object;
    } catch (error) {
      logger.error("Error evaluating result:", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : void 0
      });
      return {
        isRelevant: false,
        reason: "Error in evaluation"
      };
    }
  }
});

export { evaluateResultTool };
