/**
 * Self-Evolving Research Workflow
 * 
 * A complete workflow that:
 * 1. Loads strategy
 * 2. Executes research with strategy config
 * 3. Analyzes performance  
 * 4. Evolves strategy if needed
 */

import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { getActiveStrategy } from '@/repositories/strategies';
import { analyzeEpisodePerformance, shouldEvolveStrategy, evolveStrategy } from '@/lib/strategyEvolution';
import { updateEpisodeStatus } from '@/repositories/episodes';
import { createNote } from '@/repositories/notes';

// Step 1: Load Strategy Configuration
const loadStrategyStep = createStep({
  id: 'load-strategy',
  description: 'Load active strategy configuration for the topic',
  inputSchema: z.object({
    topicId: z.string(),
    episodeId: z.string(),
    query: z.string(),
  }),
  execute: async ({ context: { inputData } }) => {
    const strategy = await getActiveStrategy(inputData.topicId);
    
    if (!strategy) {
      return {
        ...inputData,
        strategyVersion: 1,
        config: {
          searchDepth: 'standard',
          timeWindow: 'week',
          summaryTemplates: ['bullets'],
          sensoFirst: false,
        },
      };
    }

    const config = JSON.parse(strategy.configJson);
    
    return {
      ...inputData,
      strategyVersion: strategy.version,
      config,
    };
  },
});

// Step 2: Execute Research (delegated to researchAgent)
const executeResearchStep = createStep({
  id: 'execute-research',
  description: 'Execute research using the loaded strategy',
  inputSchema: z.object({
    topicId: z.string(),
    episodeId: z.string(),
    query: z.string(),
    strategyVersion: z.number(),
    config: z.any(),
  }),
  execute: async ({ context: { inputData }, mastra }) => {
    // Mark episode as running
    await updateEpisodeStatus(inputData.episodeId, 'running');
    
    const researchAgent = mastra!.getAgent('researchAgent');
    
    const searchInstructions = inputData.config.searchDepth === 'deep'
      ? 'Conduct thorough, deep research with multiple follow-up queries (up to 5).'
      : inputData.config.searchDepth === 'shallow'
      ? 'Conduct quick, focused research with minimal follow-ups (1-2 max).'
      : 'Conduct focused research with targeted follow-up queries (2-3).';
    
    // Execute research with strategy configuration
    const result = await researchAgent.generate(
      [
        {
          role: 'user',
          content: `Research the following topic: "${inputData.query}"

**Research Strategy Configuration (v${inputData.strategyVersion}):**
- Search Depth: ${inputData.config.searchDepth}
- Time Window: ${inputData.config.timeWindow}
- ${searchInstructions}
${inputData.config.maxFollowups ? `- Maximum follow-up queries: ${inputData.config.maxFollowups}` : ''}

Provide a comprehensive summary with:
1. Key findings
2. Important insights
3. Relevant sources (with URLs)

Format your response in clear, readable markdown.`,
        },
      ],
      {
        runtimeContext: {
          strategyVersion: inputData.strategyVersion,
          ...inputData.config,
          topicId: inputData.topicId,
          episodeId: inputData.episodeId,
        },
      }
    );

    // Save note
    const note = await createNote({
      topicId: inputData.topicId,
      title: `Research: ${inputData.query.substring(0, 60)}${inputData.query.length > 60 ? '...' : ''}`,
      content: result.text,
      type: 'research',
    });

    // Update episode as completed
    await updateEpisodeStatus(inputData.episodeId, 'completed', {
      resultNoteId: note.id,
      sourcesReturned: [],
      sourcesSaved: [],
    });

    return {
      ...inputData,
      result: result.text,
      noteId: note.id,
    };
  },
});

// Step 3: Analyze Episode Performance
const analyzePerformanceStep = createStep({
  id: 'analyze-performance',
  description: 'Analyze the episode performance and determine if evolution is needed',
  inputSchema: z.object({
    episodeId: z.string(),
    topicId: z.string(),
    strategyVersion: z.number(),
  }),
  execute: async ({ context: { inputData } }) => {
    const analysis = await analyzeEpisodePerformance(inputData.episodeId);
    
    const evolution = await shouldEvolveStrategy(
      inputData.topicId,
      inputData.strategyVersion,
      5 // Minimum episodes before evolution
    );

    return {
      analysis,
      shouldEvolve: evolution.shouldEvolve,
      evolutionReason: evolution.reason,
      metrics: evolution.metrics,
    };
  },
});

// Step 4: Evolve Strategy (conditional)
const evolveStrategyStep = createStep({
  id: 'evolve-strategy',
  description: 'Create a new evolved strategy version',
  inputSchema: z.object({
    topicId: z.string(),
    strategyVersion: z.number(),
    evolutionReason: z.string(),
    metrics: z.any(),
  }),
  execute: async ({ context: { inputData } }) => {
    const { newStrategy, evolutionLog } = await evolveStrategy(
      inputData.topicId,
      inputData.strategyVersion,
      {
        reason: inputData.evolutionReason,
        metrics: inputData.metrics,
      }
    );

    return {
      newStrategyVersion: newStrategy.version,
      evolutionLogId: evolutionLog.id,
      reason: evolutionLog.reason,
    };
  },
});

// Create the workflow
export const selfEvolvingResearchWorkflow = createWorkflow({
  name: 'self-evolving-research',
  triggerSchema: z.object({
    topicId: z.string(),
    episodeId: z.string(),
    query: z.string(),
  }),
})
  .then(loadStrategyStep)
  .then(executeResearchStep)
  .then(analyzePerformanceStep)
  .branch([
    // If should evolve, create new strategy
    [
      async ({ event }) => {
        const analyzeResult = event.payload;
        return analyzeResult.shouldEvolve === true;
      },
      async ({ workflow }) => {
        return workflow.then(evolveStrategyStep).commit();
      },
    ],
  ])
  .commit();

