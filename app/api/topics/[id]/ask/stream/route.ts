/**
 * Streaming Research API Route
 * 
 * POST /api/topics/[id]/ask/stream
 * Starts a research episode and streams progress updates in real-time
 */

import { NextRequest } from 'next/server';
import { createEpisode } from '@/repositories/episodes';
import { getTopicById } from '@/repositories/topics';
import { runResearchStreaming } from '@/lib/runResearchStreaming';

export const runtime = 'nodejs'; // Required for streaming
export const dynamic = 'force-dynamic'; // Disable caching

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: topicId } = await params;
    const body = await request.json();
    const { query } = body;

    if (!query || typeof query !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Query is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify topic exists
    const topic = await getTopicById(topicId);
    if (!topic) {
      return new Response(
        JSON.stringify({ error: 'Topic not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Create episode
    const episode = await createEpisode({
      topicId,
      query,
      strategyVersion: topic.activeStrategyVersion || 0,
      sourcesReturned: [],
      sourcesSaved: [],
    });

    // Create Server-Sent Events stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Send episode ID first
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'episode_created', episodeId: episode.id })}\n\n`)
          );

          // Stream research progress
          for await (const event of runResearchStreaming(episode.id)) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
            );
          }

          controller.close();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'error', error: errorMessage })}\n\n`)
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Error in streaming endpoint:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to start research' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

