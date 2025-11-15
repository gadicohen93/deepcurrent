'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getTopicById, getStrategyByVersion, StrategyConfigPayload } from '@/lib/mockData';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft } from 'lucide-react';

export default function ReplayPage() {
  const params = useParams();
  const topicId = params.id as string;
  const topic = getTopicById(topicId);

  const [strategyAVersion, setStrategyAVersion] = useState(
    topic?.strategies[0]?.version.toString() || '0'
  );
  const [strategyBVersion, setStrategyBVersion] = useState(
    topic?.activeStrategyVersion.toString() || '1'
  );
  const [query, setQuery] = useState('How do self-evolving agents improve over time?');

  if (!topic) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Topic not found</p>
      </div>
    );
  }

  const strategyA = getStrategyByVersion(topic, parseInt(strategyAVersion));
  const strategyB = getStrategyByVersion(topic, parseInt(strategyBVersion));

  const renderStrategyMetadata = (strategy: StrategyConfigPayload) => (
    <div className="space-y-3 text-sm">
      <div>
        <p className="font-medium mb-2">Tools</p>
        <div className="flex flex-wrap gap-2">
          {strategy.tools.map((tool) => (
            <Badge key={tool} variant="outline">
              {tool}
            </Badge>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-muted-foreground">Senso-first</p>
          <p className="font-medium">{strategy.sensoFirst ? 'On' : 'Off'}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Search depth</p>
          <p className="font-medium capitalize">{strategy.searchDepth}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Time window</p>
          <p className="font-medium capitalize">{strategy.timeWindow}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Status</p>
          <Badge variant="secondary">{strategy.status}</Badge>
        </div>
      </div>
      <div>
        <p className="font-medium mb-2">Summary Templates</p>
        <div className="flex flex-wrap gap-2">
          {strategy.summaryTemplates.map((template) => (
            <Badge key={template} variant="secondary">
              {template}
            </Badge>
          ))}
        </div>
      </div>
    </div>
  );

  const renderMockResponse = (strategy: StrategyConfigPayload) => {
    const tools = strategy.tools.join(', ');
    const depth = strategy.searchDepth;
    const sensoFirst = strategy.sensoFirst;

    return (
      <div className="prose prose-sm max-w-none">
        <h3>Research Response (Mock)</h3>
        <p>
          <strong>Query:</strong> {query}
        </p>

        <h4>Approach:</h4>
        <ul>
          <li>Tools used: {tools}</li>
          <li>Search depth: {depth}</li>
          <li>Senso-first mode: {sensoFirst ? 'enabled' : 'disabled'}</li>
          <li>Time window: {strategy.timeWindow}</li>
        </ul>

        <h4>Key Findings:</h4>
        {strategy.summaryTemplates.includes('bullets') && (
          <>
            <p>
              <strong>Bullet Points:</strong>
            </p>
            <ul>
              <li>
                Self-evolving agents use fitness metrics to evaluate strategy performance
              </li>
              <li>
                Meta-learning approaches enable agents to adapt their learning strategies
              </li>
              <li>Evolutionary algorithms can optimize tool selection and parameters</li>
            </ul>
          </>
        )}

        {strategy.summaryTemplates.includes('comparison') && (
          <>
            <p>
              <strong>Comparison Table:</strong>
            </p>
            <table>
              <thead>
                <tr>
                  <th>Approach</th>
                  <th>Pros</th>
                  <th>Cons</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Evolutionary Strategies</td>
                  <td>Robust, no gradient needed</td>
                  <td>Sample inefficient</td>
                </tr>
                <tr>
                  <td>Meta-Learning</td>
                  <td>Fast adaptation</td>
                  <td>Requires careful design</td>
                </tr>
              </tbody>
            </table>
          </>
        )}

        {strategy.summaryTemplates.includes('narrative') && (
          <>
            <h4>Narrative Summary:</h4>
            <p>
              Self-evolving agents represent a frontier in AI research, combining principles
              from evolutionary computation with modern machine learning. These systems
              continuously monitor their own performance and adjust their strategies based on
              observed outcomes. By leveraging techniques like {tools}, they can discover
              optimal configurations that would be difficult to hand-engineer.
            </p>
          </>
        )}

        <h4>Performance Impact:</h4>
        <p>
          This strategy configuration has achieved a fitness score of{' '}
          {strategy.fitness?.toFixed(2) || 'N/A'} across{' '}
          {strategy.metrics?.episodes || 'N/A'} episodes.
        </p>
      </div>
    );
  };

  const getDifferences = () => {
    if (!strategyA || !strategyB) return [];

    const diffs: string[] = [];

    // Check Senso-first
    if (strategyA.sensoFirst !== strategyB.sensoFirst) {
      diffs.push(
        `Strategy B ${strategyB.sensoFirst ? 'uses' : 'does not use'} Senso-first mode; Strategy A ${strategyA.sensoFirst ? 'uses' : 'does not use'} it.`
      );
    }

    // Check search depth
    if (strategyA.searchDepth !== strategyB.searchDepth) {
      diffs.push(
        `Strategy B uses ${strategyB.searchDepth} search; Strategy A uses ${strategyA.searchDepth} search.`
      );
    }

    // Check tools
    const toolsA = new Set(strategyA.tools);
    const toolsB = new Set(strategyB.tools);
    const toolDiff = [...toolsB].filter((t) => !toolsA.has(t));
    if (toolDiff.length > 0) {
      diffs.push(`Strategy B includes additional tools: ${toolDiff.join(', ')}.`);
    }

    // Check templates
    const templatesA = new Set(strategyA.summaryTemplates);
    const templatesB = new Set(strategyB.summaryTemplates);
    const templateDiff = [...templatesB].filter((t) => !templatesA.has(t));
    if (templateDiff.length > 0) {
      diffs.push(
        `Strategy B includes additional summary formats: ${templateDiff.join(', ')}.`
      );
    }

    // Check time window
    if (strategyA.timeWindow !== strategyB.timeWindow) {
      diffs.push(
        `Strategy B uses ${strategyB.timeWindow} time window; Strategy A uses ${strategyA.timeWindow}.`
      );
    }

    // Check fitness
    if (strategyA.fitness && strategyB.fitness) {
      const fitnessDiff = strategyB.fitness - strategyA.fitness;
      if (fitnessDiff > 0) {
        diffs.push(
          `Strategy B has higher fitness: ${strategyB.fitness.toFixed(2)} vs ${strategyA.fitness.toFixed(2)} (+${fitnessDiff.toFixed(2)}).`
        );
      } else if (fitnessDiff < 0) {
        diffs.push(
          `Strategy A has higher fitness: ${strategyA.fitness.toFixed(2)} vs ${strategyB.fitness.toFixed(2)} (${fitnessDiff.toFixed(2)}).`
        );
      }
    }

    return diffs;
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b">
        <div className="container mx-auto py-4 px-4">
          <div className="flex items-center gap-4">
            <Link href={`/topics/${topicId}`}>
              <Button variant="ghost" size="sm">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Workspace
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold">Replay Strategies</h1>
              <p className="text-sm text-muted-foreground">{topic.title}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="container mx-auto px-4 py-6">
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Strategy A</Label>
                <Select value={strategyAVersion} onValueChange={setStrategyAVersion}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {topic.strategies.map((s) => (
                      <SelectItem key={s.version} value={s.version.toString()}>
                        v{s.version} ({s.status})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Strategy B</Label>
                <Select value={strategyBVersion} onValueChange={setStrategyBVersion}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {topic.strategies.map((s) => (
                      <SelectItem key={s.version} value={s.version.toString()}>
                        v{s.version} ({s.status})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Query</Label>
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Enter research question..."
                />
              </div>
            </div>
            <div className="mt-4">
              <Button className="w-full md:w-auto">Run Replay</Button>
            </div>
          </CardContent>
        </Card>

        {/* Side-by-side Comparison */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          {/* Strategy A */}
          {strategyA && (
            <Card>
              <CardHeader>
                <CardTitle>Strategy v{strategyA.version}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {renderStrategyMetadata(strategyA)}
                <Separator />
                {renderMockResponse(strategyA)}
              </CardContent>
            </Card>
          )}

          {/* Strategy B */}
          {strategyB && (
            <Card>
              <CardHeader>
                <CardTitle>Strategy v{strategyB.version}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {renderStrategyMetadata(strategyB)}
                <Separator />
                {renderMockResponse(strategyB)}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Differences Summary */}
        <Card>
          <CardHeader>
            <CardTitle>Key Differences</CardTitle>
          </CardHeader>
          <CardContent>
            {getDifferences().length > 0 ? (
              <ul className="space-y-2">
                {getDifferences().map((diff, i) => (
                  <li key={i} className="text-sm">
                    • {diff}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No significant differences between these strategies.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

