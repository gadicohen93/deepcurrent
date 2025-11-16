/**
 * Streaming Research Function
 * 
 * Runs research agent with real-time progress updates via async generator
 */

import { mastra } from '@/mastra';
import { createNote } from '@/repositories/notes';
import { updateEpisodeStatus, getEpisodeById } from '@/repositories/episodes';
import { getTopicById } from '@/repositories/topics';
import { getActiveStrategy } from '@/repositories/strategies';
import { postEpisodeAnalysis } from './strategyEvolution';
import type { ResearchStreamEvent } from '@/lib/api/research';

/**
 * Run research with streaming progress updates
 * @param episodeId - The ID of the episode to run research for
 */
export async function* runResearchStreaming(
  episodeId: string
): AsyncGenerator<ResearchStreamEvent> {
  try {
    // Load episode and topic
    const episode = await getEpisodeById(episodeId);
    if (!episode) {
      yield { type: 'error', error: 'Episode not found' };
      return;
    }

    const topic = await getTopicById(episode.topicId);
    if (!topic) {
      yield { type: 'error', error: 'Topic not found' };
      return;
    }

    // Load active strategy configuration
    const activeStrategy = await getActiveStrategy(episode.topicId);
    let strategyConfig: any = {
      searchDepth: 'standard',
      timeWindow: 'week',
      summaryTemplates: ['bullets', 'narrative'],
    };

    if (activeStrategy) {
      try {
        strategyConfig = JSON.parse(activeStrategy.configJson);
        yield {
          type: 'status',
          status: 'initializing',
          message: `🧠 Using strategy v${activeStrategy.version}`,
          details: { strategyVersion: activeStrategy.version },
        };
      } catch (e) {
        console.error('Error parsing strategy config:', e);
      }
    }

    yield {
      type: 'status',
      status: 'searching',
      message: 'Starting research...',
    };

    await updateEpisodeStatus(episodeId, 'running');

    // Stream research agent execution
    let fullContent = '';
    const toolCalls: Array<{ tool: string; args: Record<string, unknown>; result?: string }> = [];

    // Get the research agent from mastra instance so tools have access to other agents
    const researchAgent = mastra.getAgent('researchAgent');
    
    // Customize prompt based on strategy
    const searchInstructions = strategyConfig.searchDepth === 'deep'
      ? 'Conduct thorough, deep research with multiple follow-up queries (up to 5).'
      : strategyConfig.searchDepth === 'shallow'
      ? 'Conduct quick, focused research with minimal follow-ups (1-2 max).'
      : 'Conduct focused research with targeted follow-up queries (2-3).';
    
    const timeWindowInstructions = strategyConfig.timeWindow === 'month' || strategyConfig.timeWindow === 'all'
      ? 'Consider both recent and historical sources.'
      : 'Focus on recent and current information.';

    const outputStyle = (strategyConfig.summaryTemplates || ['bullets']).includes('narrative')
      ? 'Format as a narrative with clear sections and flowing prose.'
      : 'Format as clear bullet points and structured sections.';
    
    const stream = await researchAgent.streamVNext(
      `Research the following topic: "${episode.query}"

**Research Strategy Configuration (v${activeStrategy?.version ?? 1}):**
- Search Depth: ${strategyConfig.searchDepth}
- ${searchInstructions}
- ${timeWindowInstructions}
- ${outputStyle}
${strategyConfig.maxFollowups ? `- Maximum follow-up queries: ${strategyConfig.maxFollowups}` : ''}

Provide a comprehensive summary with:
1. Key findings
2. Important insights
3. Relevant sources (with URLs)

Format your response in clear, readable markdown.`,
      {
        format: 'aisdk',
        // Pass strategy as runtime context that tools can access
        runtimeContext: {
          strategyVersion: activeStrategy?.version ?? 1,
          searchDepth: strategyConfig.searchDepth,
          timeWindow: strategyConfig.timeWindow,
          sensoFirst: strategyConfig.sensoFirst ?? false,
          maxFollowups: strategyConfig.maxFollowups,
          summaryTemplates: strategyConfig.summaryTemplates,
          topicId: episode.topicId,
          episodeId: episode.id,
        },
      }
    );

    // Process the stream
    for await (const chunk of stream.fullStream) {
      if (chunk.type === 'text-delta') {
        const text = chunk.text;
        fullContent += text;
        yield {
          type: 'partial',
          content: text,
        };
      } else if (chunk.type === 'tool-call') {
        const toolName = chunk.toolName;
        const args = chunk.input;

        toolCalls.push({ tool: toolName, args });

        yield {
          type: 'tool_call',
          tool: toolName,
          args,
        };

        // Update status based on tool with more details
        if (toolName === 'linkupSearchTool') {
          yield {
            type: 'status',
            status: 'searching',
            message: `🔍 Searching: ${args?.query ?? 'web'}`,
            details: { query: args?.query },
          };
        } else if (toolName === 'evaluateResultsBatchTool') {
          const resultCount = Array.isArray(args?.results) ? args.results.length : 0;
          yield {
            type: 'status',
            status: 'evaluating',
            message: `⚖️ Evaluating ${resultCount} search results...`,
            details: { query: args?.query, resultCount },
          };
        } else if (toolName === 'extractLearningsTool') {
          yield {
            type: 'status',
            status: 'extracting',
            message: `💡 Extracting key learnings from: ${args?.result?.title ?? 'result'}`,
            details: { url: args?.result?.url },
          };
        }
      } else if (chunk.type === 'tool-result') {
        const output = chunk.output;
        const toolName = chunk.toolName;
        const resultString = JSON.stringify(output);
        
        const lastCall = toolCalls[toolCalls.length - 1];
        if (lastCall !== undefined) {
          lastCall.result = resultString;
        }

        // Parse and send detailed results based on tool type
        try {
          if (toolName === 'linkupSearchTool' && output !== null && typeof output === 'object') {
            const outputObj = output as { results?: Array<{ url?: string }> };
            const results = outputObj.results ?? [];
            const urls = results.map((r) => r.url).filter((url): url is string => url !== undefined && url !== null);
            
            yield {
              type: 'search_results',
              query: (lastCall?.args?.query as string | undefined) ?? 'unknown',
              count: results.length,
              urls: urls.slice(0, 5), // Top 5 URLs
            };
          } else if (toolName === 'evaluateResultsBatchTool' && output !== null && typeof output === 'object') {
            const outputObj = output as { evaluations?: Array<{ url?: string; isRelevant?: boolean; reason?: string }> };
            const evaluations = outputObj.evaluations ?? [];
            const relevant = evaluations.filter((e) => e.isRelevant === true).length;
            
            yield {
              type: 'evaluation_results',
              evaluated: evaluations.length,
              relevant,
              results: evaluations.slice(0, 3).map((e) => ({
                url: e.url ?? 'unknown',
                isRelevant: e.isRelevant ?? false,
                reason: e.reason ?? 'no reason provided',
              })),
            };
          } else if (toolName === 'extractLearningsTool' && output !== null && typeof output === 'object') {
            const outputObj = output as { learning?: string; followUpQuestions?: string[] };
            const learning = outputObj.learning ?? '';
            const followUpQuestions = outputObj.followUpQuestions ?? [];
            
            yield {
              type: 'learning_extracted',
              learning: learning.substring(0, 200) + (learning.length > 200 ? '...' : ''),
              followUpQuestions: followUpQuestions.slice(0, 2),
            };
          }
        } catch {
          // If parsing fails, just continue
        }

        // Always send the raw result too
        yield {
          type: 'tool_result',
          tool: toolName,
          result: resultString,
        };
      }
    }

    // Create note with full content
    yield {
      type: 'status',
      status: 'saving',
      message: 'Creating note...',
    };

    const note = await createNote({
      topicId: episode.topicId,
      title: `Research: ${episode.query.substring(0, 60)}${episode.query.length > 60 ? '...' : ''}`,
      content: fullContent,
      type: 'research',
    });

    yield {
      type: 'note_created',
      noteId: note.id,
      noteTitle: note.title,
    };

    // Update episode as completed
    await updateEpisodeStatus(episodeId, 'completed', {
      resultNoteId: note.id,
      sourcesReturned: [],
      sourcesSaved: [],
      toolUsage: toolCalls,
    });

    yield {
      type: 'complete',
      episodeId: episode.id,
      noteId: note.id,
    };

    // Post-episode analysis (runs in background)
    postEpisodeAnalysis(episodeId).catch((error) => {
      console.error('Post-episode analysis failed:', error);
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    await updateEpisodeStatus(episodeId, 'failed', {
      errorMessage,
    });

    yield {
      type: 'error',
      error: errorMessage,
    };
  }
}

