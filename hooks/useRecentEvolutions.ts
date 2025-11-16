/**
 * Hook to poll for recent strategy evolutions
 * 
 * Shows evolution notifications even when they happen in background
 */

'use client';

import { useState, useEffect } from 'react';

export interface Evolution {
  fromVersion: number;
  toVersion: number;
  reason: string;
  timestamp: string;
  changes?: {
    before: Record<string, any>;
    after: Record<string, any>;
    metrics?: Record<string, any>;
  } | null;
}

export function useRecentEvolutions(topicId: string, enabled: boolean = true) {
  const [evolutions, setEvolutions] = useState<Evolution[]>([]);
  const [lastChecked, setLastChecked] = useState<Date>(new Date());

  useEffect(() => {
    if (!enabled) return;

    const checkForEvolutions = async () => {
      try {
        const response = await fetch(`/api/topics/${topicId}/evolutions?recent=true`);
        if (response.ok) {
          const data: Evolution[] = await response.json();
          
          // Filter to only show evolutions that happened after last check
          const newEvolutions = data.filter(
            (evo) => new Date(evo.timestamp) > lastChecked
          );

          if (newEvolutions.length > 0) {
            setEvolutions((prev) => [...newEvolutions, ...prev]);
            setLastChecked(new Date());
          }
        }
      } catch (error) {
        console.error('Error fetching evolutions:', error);
      }
    };

    // Check immediately
    checkForEvolutions();

    // Then poll every 5 seconds for faster detection
    const interval = setInterval(checkForEvolutions, 5000);

    return () => clearInterval(interval);
  }, [topicId, enabled, lastChecked]);

  const dismissEvolution = (toVersion: number) => {
    setEvolutions((prev) => prev.filter((e) => e.toVersion !== toVersion));
  };

  return { evolutions, dismissEvolution };
}

