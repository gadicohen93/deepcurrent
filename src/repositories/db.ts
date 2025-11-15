/**
 * Prisma Client Instance
 *
 * Singleton Prisma Client for database access.
 * Uses the DATABASE_URL from environment variables.
 */

import { PrismaClient } from '@prisma/client';

// Prevent multiple instances of Prisma Client in development
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/**
 * Graceful shutdown helper
 */
export async function disconnectPrisma() {
  await prisma.$disconnect();
}
