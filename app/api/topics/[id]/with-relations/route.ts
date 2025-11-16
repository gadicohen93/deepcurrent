import { NextRequest, NextResponse } from 'next/server';
import { getTopicByIdWithRelations } from '@/repositories/topics';

/**
 * GET /api/topics/:id/with-relations
 * Get a topic with all related data (strategies, notes, episodes, evolution logs)
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const topic = await getTopicByIdWithRelations(id);

    if (!topic) {
      return NextResponse.json(
        { error: 'Topic not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(topic);
  } catch (error) {
    console.error('Error fetching topic with relations:', error);
    return NextResponse.json(
      { error: 'Failed to fetch topic with relations' },
      { status: 500 }
    );
  }
}
