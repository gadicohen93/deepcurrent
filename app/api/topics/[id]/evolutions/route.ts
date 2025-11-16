import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/repositories/db';

/**
 * GET /api/topics/[id]/evolutions
 * Get strategy evolution logs for a topic
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: topicId } = await params;
    const { searchParams } = new URL(request.url);
    const recent = searchParams.get('recent') === 'true';

    const evolutions = await prisma.strategyEvolutionLog.findMany({
      where: { topicId },
      orderBy: { createdAt: 'desc' },
      take: recent ? 5 : undefined,
    });

    const formatted = evolutions.map((log) => ({
      fromVersion: log.fromVersion,
      toVersion: log.toVersion,
      reason: log.reason || 'No reason provided',
      timestamp: log.createdAt.toISOString(),
      changes: log.changesJson ? JSON.parse(log.changesJson) : null,
    }));

    return NextResponse.json(formatted);
  } catch (error) {
    console.error('Error fetching evolutions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch evolutions' },
      { status: 500 }
    );
  }
}

