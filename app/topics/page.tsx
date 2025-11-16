'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { fetchTopics, createTopic, type Topic } from '@/lib/api/topics';
import { Badge } from '@/components/ui/badge';
import { ArrowRight } from 'lucide-react';

export default function TopicsPage() {
  const router = useRouter();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    async function loadTopics() {
      try {
        setLoading(true);
        const data = await fetchTopics();
        setTopics(data);
        setError(null);
      } catch (err) {
        console.error('Error loading topics:', err);
        setError('Failed to load topics');
      } finally {
        setLoading(false);
      }
    }

    loadTopics();
  }, []);

  const handleCreateTopic = async () => {
    const title = window.prompt('Enter topic title:');
    if (!title) return;

    const description = window.prompt('Enter topic description (optional):');

    try {
      setCreating(true);
      const newTopic = await createTopic({
        title,
        description: description || undefined,
      });

      // Redirect to the new topic page
      router.push(`/topics/${newTopic.id}`);
    } catch (err) {
      console.error('Error creating topic:', err);
      alert('Failed to create topic. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen relative">
      {/* Header */}
      <header className="fixed top-0 left-0 w-full z-50 glass-header">
        <nav className="container mx-auto max-w-7xl px-6 py-4 flex justify-between items-center">
          <div className="flex items-baseline gap-3">
            <Link href="/" className="text-2xl font-bold">
              <span className="text-gradient">DeepCurrent</span>
            </Link>
            <span className="text-sm text-gray-500">Self-Evolving Research OS</span>
          </div>
        </nav>
      </header>

      {/* Main Content */}
      <main className="relative z-10 pt-24">
        <div className="container mx-auto py-16 px-6 max-w-7xl">
          {/* Topics Header */}
          <div className="mb-12 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-semibold text-white mb-2">Your Topics</h1>
              <p className="text-gray-400">Autonomous systems that evolve and build insight continuously</p>
            </div>
            <button
              onClick={handleCreateTopic}
              disabled={creating}
              className="glass-input px-5 py-2.5 rounded-xl text-sm font-medium text-gray-300 hover:text-white hover:border-purple-500/50 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="text-lg">+</span> {creating ? 'Creating...' : 'New topic'}
            </button>
          </div>

          {/* Loading State */}
          {loading && (
            <div className="max-w-5xl mx-auto text-center py-12">
              <div className="glass-card p-12 rounded-2xl">
                <p className="text-gray-300">Loading topics...</p>
              </div>
            </div>
          )}

          {/* Error State */}
          {error && (
            <div className="max-w-5xl mx-auto text-center py-12">
              <div className="glass-card p-12 rounded-2xl border-red-500/30">
                <p className="text-red-300">{error}</p>
              </div>
            </div>
          )}

          {/* Empty State */}
          {!loading && !error && topics.length === 0 && (
            <div className="max-w-5xl mx-auto text-center py-12">
              <div className="glass-card p-12 rounded-2xl">
                <p className="text-gray-300 text-lg mb-2">No topics yet</p>
                <p className="text-gray-500 text-sm">
                  Create your first topic to start building autonomous research agents
                </p>
              </div>
            </div>
          )}

          {/* Topics Grid */}
          {!loading && !error && topics.length > 0 && (
            <div className="max-w-5xl mx-auto space-y-4">
              {topics.map((topic) => {
              const activeStrategy = topic.strategies.find(
                (s) => s.version === topic.activeStrategyVersion
              );
              
              // Find latest evolution
              const latestEvolution = topic.evolutionLogs.length > 0 
                ? topic.evolutionLogs[topic.evolutionLogs.length - 1]
                : null;

              return (
                <Link key={topic.id} href={`/topics/${topic.id}`}>
                  <div className="glass-card p-6 rounded-2xl cursor-pointer group hover:border-purple-500/30 transition-all">
                    <div className="flex items-start justify-between gap-6">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-3">
                          <h3 className="text-xl font-semibold text-white group-hover:text-gradient transition-all">
                            {topic.title}
                          </h3>
                          <Badge className="bg-gradient-button text-white border-0 text-xs">
                            v{topic.activeStrategyVersion}
                          </Badge>
                        </div>
                        
                        {topic.description && (
                          <p className="text-gray-300 text-sm leading-relaxed mb-4">
                            {topic.description}
                          </p>
                        )}

                        {/* Stats row */}
                        <div className="flex items-center gap-3 text-sm text-gray-400">
                          <span>{topic.notes.length} notes</span>
                          <span>•</span>
                          <span>{topic.strategies.length} strategies</span>
                          {activeStrategy?.metrics && (
                            <>
                              <span>•</span>
                              <span>{Math.round(activeStrategy.metrics.saveRate * 100)}% save rate</span>
                            </>
                          )}
                        </div>

                        {/* Last evolution info */}
                        {latestEvolution && activeStrategy?.fitness && (
                          <div className="mt-3 text-xs text-purple-300/70">
                            Last evolution: v{latestEvolution.toVersion}, 
                            {activeStrategy.fitness > 0.75 ? ' +' : ' '}
                            {activeStrategy.fitness.toFixed(2)} fitness
                          </div>
                        )}
                      </div>

                      <ArrowRight className="w-5 h-5 text-gray-500 group-hover:text-purple-400 group-hover:translate-x-1 transition-all shrink-0 mt-1" />
                    </div>
                  </div>
                </Link>
              );
            })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

