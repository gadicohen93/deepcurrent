/**
 * Notes Repository
 *
 * Data access layer for Note entities.
 * Notes are the user-facing research artifacts.
 */

import { prisma } from './db';
import type { Note, CreateNoteInput } from './types';

/**
 * Get a note by ID
 */
export async function getNoteById(noteId: string): Promise<Note | null> {
  return prisma.note.findUnique({
    where: { id: noteId },
  });
}

/**
 * Get a note with related episodes
 */
export async function getNoteByIdWithEpisodes(noteId: string) {
  return prisma.note.findUnique({
    where: { id: noteId },
    include: {
      episodes: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });
}

/**
 * Create a new note
 */
export async function createNote(input: CreateNoteInput): Promise<Note> {
  return prisma.note.create({
    data: {
      topicId: input.topicId,
      title: input.title,
      content: input.content,
      type: input.type,
    },
  });
}

/**
 * Update a note
 */
export async function updateNote(
  noteId: string,
  data: Partial<Pick<Note, 'title' | 'content' | 'type'>>
): Promise<Note> {
  return prisma.note.update({
    where: { id: noteId },
    data,
  });
}

/**
 * Delete a note
 */
export async function deleteNote(noteId: string): Promise<Note> {
  return prisma.note.delete({
    where: { id: noteId },
  });
}

/**
 * List notes for a topic
 */
export async function listNotesForTopic(
  topicId: string,
  limit?: number
): Promise<Note[]> {
  return prisma.note.findMany({
    where: { topicId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/**
 * List notes by type
 */
export async function listNotesByType(
  topicId: string,
  type: string,
  limit?: number
): Promise<Note[]> {
  return prisma.note.findMany({
    where: {
      topicId,
      type,
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/**
 * Search notes by content
 */
export async function searchNotes(
  topicId: string,
  query: string,
  limit?: number
): Promise<Note[]> {
  return prisma.note.findMany({
    where: {
      topicId,
      OR: [
        { title: { contains: query } },
        { content: { contains: query } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/**
 * Get recent notes across all topics
 */
export async function getRecentNotes(limit = 10): Promise<Note[]> {
  return prisma.note.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      topic: {
        select: {
          id: true,
          title: true,
        },
      },
    },
  });
}
