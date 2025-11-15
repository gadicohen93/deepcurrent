/**
 * Topics Repository
 *
 * Data access layer for Topic entities.
 */

import { prisma } from './db';
import type { Topic, CreateTopicInput } from './types';

/**
 * Get a topic by ID
 */
export async function getTopicById(topicId: string): Promise<Topic | null> {
  return prisma.topic.findUnique({
    where: { id: topicId },
  });
}

/**
 * Get a topic by ID with all relations
 */
export async function getTopicByIdWithRelations(topicId: string) {
  return prisma.topic.findUnique({
    where: { id: topicId },
    include: {
      strategyConfigs: {
        orderBy: { version: 'desc' },
      },
      notes: {
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
      episodes: {
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
      evolutionLogs: {
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
    },
  });
}

/**
 * Create a new topic
 */
export async function createTopic(input: CreateTopicInput): Promise<Topic> {
  return prisma.topic.create({
    data: {
      title: input.title,
      description: input.description,
      userId: input.userId,
      raindropCollectionId: input.raindropCollectionId,
    },
  });
}

/**
 * Update a topic
 */
export async function updateTopic(
  topicId: string,
  data: Partial<Omit<Topic, 'id' | 'createdAt' | 'updatedAt'>>
): Promise<Topic> {
  return prisma.topic.update({
    where: { id: topicId },
    data,
  });
}

/**
 * Delete a topic (cascades to related entities)
 */
export async function deleteTopic(topicId: string): Promise<Topic> {
  return prisma.topic.delete({
    where: { id: topicId },
  });
}

/**
 * List all topics
 */
export async function listTopics(userId?: string): Promise<Topic[]> {
  return prisma.topic.findMany({
    where: userId ? { userId } : undefined,
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Search topics by title or description
 */
export async function searchTopics(query: string, userId?: string): Promise<Topic[]> {
  return prisma.topic.findMany({
    where: {
      AND: [
        {
          OR: [
            { title: { contains: query } },
            { description: { contains: query } },
          ],
        },
        userId ? { userId } : {},
      ],
    },
    orderBy: { createdAt: 'desc' },
  });
}
