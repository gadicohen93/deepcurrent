import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { PinoLogger } from "@mastra/loggers";

const logger = new PinoLogger({ level: 'info' });

export const extractLearningsTool = createTool({
  id: 'extract-learnings',
  description: 'Extract key learnings and follow-up questions from a search result',
  inputSchema: z.object({
    query: z.string().describe('The original research query'),
    result: z
      .object({
        title: z.string(),
        url: z.string(),
        content: z.string(),
      })
      .describe('The search result to process'),
  }),
  execute: async ({ context, mastra }) => {
    // Let Mastra automatically manage spans - don't create or end spans manually
    // Mastra's framework will handle span lifecycle automatically
    try {
      const { query, result } = context;

      if (!mastra) {
        throw new Error('Mastra instance not found');
      }
      const learningExtractionAgent = mastra.getAgent('learningExtractionAgent');
      if (!learningExtractionAgent) {
        throw new Error('learningExtractionAgent not found on mastra instance');
      }
      logger.info('Extracting learnings from search result', { title: result.title, url: result.url });
      
      // Use generateVNext() for V2 models (gemini-2.5-flash-lite) as per Mastra issue #7042
      const response = await learningExtractionAgent.generateVNext(
        [
          {
            role: 'user',
            content: `The user is researching "${query}".
            Extract a key learning and generate follow-up questions from this search result:

            Title: ${result.title}
            URL: ${result.url}
            Content: ${result.content.substring(0, 8000)}...

            Respond with a JSON object containing:
            - learning: string with the key insight from the content
            - followUpQuestions: array of up to 1 follow-up question for deeper research`,
          },
        ],
        {
          experimental_output: z.object({
            learning: z.string(),
            followUpQuestions: z.array(z.string()).max(1),
          }),
        },
      );

      logger.info('Learning extraction response', { result: response.object });

      return response.object;
    } catch (error) {
      logger.error('Error extracting learnings', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return {
        learning: 'Error extracting information',
        followUpQuestions: [],
      };
    }
  },
});
