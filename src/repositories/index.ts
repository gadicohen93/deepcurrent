/**
 * Core Platform Repository Layer
 *
 * Main entry point for all database operations.
 * Provides a clean, stable API for the DeepCurrent data model.
 *
 * Usage:
 *   import { topics, strategies, notes, episodes, evolutionLogs } from '@/repositories';
 *
 *   const topic = await topics.getTopicById('topic-id');
 *   const activeStrategy = await strategies.getActiveStrategy('topic-id');
 */

// Export database instance
export { prisma, disconnectPrisma } from './db';

// Export types
export * from './types';

// Export all repository modules as namespaces
import * as topics from './topics';
import * as strategies from './strategies';
import * as notes from './notes';
import * as episodes from './episodes';
import * as evolutionLogs from './evolution-logs';

export { topics, strategies, notes, episodes, evolutionLogs };

// Also export individual functions for convenience
export * from './topics';
export * from './strategies';
export * from './notes';
export * from './episodes';
export * from './evolution-logs';
