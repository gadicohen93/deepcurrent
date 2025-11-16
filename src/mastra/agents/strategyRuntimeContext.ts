/**
 * Strategy Runtime Context
 * 
 * Passes strategy configuration to agent runtime so tools can adapt behavior
 */

import { z } from 'zod';

export interface StrategyRuntimeContext {
  strategyVersion: number;
  searchDepth: 'shallow' | 'standard' | 'deep';
  timeWindow: 'day' | 'week' | 'month' | 'all';
  sensoFirst: boolean;
  maxFollowups?: number;
  summaryTemplates: string[];
  enabledTools?: string[];
}

export const StrategyRuntimeContextSchema = z.object({
  strategyVersion: z.number(),
  searchDepth: z.enum(['shallow', 'standard', 'deep']).default('standard'),
  timeWindow: z.enum(['day', 'week', 'month', 'all']).default('week'),
  sensoFirst: z.boolean().default(false),
  maxFollowups: z.number().optional(),
  summaryTemplates: z.array(z.string()).default(['bullets']),
  enabledTools: z.array(z.string()).optional(),
});

