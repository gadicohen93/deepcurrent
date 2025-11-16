import { NextRequest, NextResponse } from 'next/server';
import { searchTopics } from '@/repositories/topics';

/**
 * GET /api/topics/search?q=query&userId=optional
 * Search topics by title or description
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');
    const userId = searchParams.get('userId') || undefined;

    if (!query) {
      return NextResponse.json(
        { error: 'Search query (q) is required' },
        { status: 400 }
      );
    }

    const topics = await searchTopics(query, userId);
    return NextResponse.json(topics);
  } catch (error) {
    console.error('Error searching topics:', error);
    return NextResponse.json(
      { error: 'Failed to search topics' },
      { status: 500 }
    );
  }
}
