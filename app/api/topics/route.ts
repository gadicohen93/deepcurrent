import { NextRequest, NextResponse } from 'next/server';
import { listTopics, createTopic } from '@/repositories/topics';
import { createDefaultStrategy } from '@/repositories/strategies';
import type { CreateTopicInput } from '@/repositories/types';

/**
 * GET /api/topics
 * List all topics, optionally filtered by userId
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') || undefined;

    const topics = await listTopics(userId);
    return NextResponse.json(topics);
  } catch (error) {
    console.error('Error fetching topics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch topics' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/topics
 * Create a new topic
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required fields
    if (!body.title) {
      return NextResponse.json(
        { error: 'Title is required' },
        { status: 400 }
      );
    }

    const input: CreateTopicInput = {
      title: body.title,
      description: body.description,
      userId: body.userId,
      raindropCollectionId: body.raindropCollectionId,
    };

    const topic = await createTopic(input);
    
    // Create a default strategy for the new topic
    await createDefaultStrategy(topic.id);
    
    return NextResponse.json(topic, { status: 201 });
  } catch (error) {
    console.error('Error creating topic:', error);
    return NextResponse.json(
      { error: 'Failed to create topic' },
      { status: 500 }
    );
  }
}
