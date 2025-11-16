/**
 * Streaming Research Function
 * 
 * Runs research agent with real-time progress updates via async generator
 */

import { researchAgent } from '@/mastra/agents/researchAgent';
import { createNote } from '@/repositories/notes';
import { updateEpisodeStatus, getEpisodeById } from '@/repositories/episodes';
import { getTopicById } from '@/repositories/topics';
import type { ResearchStreamEvent } from '@/lib/api/research';

/**
 * Run research with streaming progress updates
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

    yield {
      type: 'status',
      status: 'searching',
      message: 'Starting research...',
    };

    await updateEpisodeStatus(episodeId, 'running');

    // Stream research agent execution
    let fullContent = '';
    const toolCalls: Array<{ tool: string; args: any; result?: string }> = [];

    const stream = await researchAgent.generateVNext(
      [
        {
          role: 'user',
          content: `Research the following topic thoroughly: "${episode.query}"

Provide a comprehensive summary with:
1. Key findings
2. Important insights
3. Relevant sources

Format your response in clear, readable markdown.`,
        },
      ],
      {
        stream: true,
      }
    );

    // Process the stream
    for await (const chunk of stream.fullStream) {
      if (chunk.type === 'text-delta') {
        fullContent += chunk.textDelta;
        yield {
          type: 'partial',
          content: chunk.textDelta,
        };
      } else if (chunk.type === 'tool-call') {
        const toolName = chunk.toolName;
        const args = chunk.args;

        toolCalls.push({ tool: toolName, args });

        yield {
          type: 'tool_call',
          tool: toolName,
          args,
        };

        // Update status based on tool
        if (toolName === 'linkupSearchTool') {
          yield {
            type: 'status',
            status: 'searching',
            message: `Searching: ${args.query || 'web'}`,
          };
        } else if (toolName === 'evaluateResultsBatchTool') {
          yield {
            type: 'status',
            status: 'evaluating',
            message: 'Evaluating search results...',
          };
        } else if (toolName === 'extractLearningsTool') {
          yield {
            type: 'status',
            status: 'extracting',
            message: 'Extracting key learnings...',
          };
        }
      } else if (chunk.type === 'tool-result') {
        const result = JSON.stringify(chunk.result);
        const lastCall = toolCalls[toolCalls.length - 1];
        if (lastCall) {
          lastCall.result = result;
        }

        yield {
          type: 'tool_result',
          tool: chunk.toolName,
          result,
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
    });

    yield {
      type: 'complete',
      episodeId: episode.id,
      noteId: note.id,
    };
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

