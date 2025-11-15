'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';

interface QueryInputProps {
  onSubmit: (query: string) => void;
  isLoading?: boolean;
}

export function QueryInput({ onSubmit, isLoading = false }: QueryInputProps) {
  const [query, setQuery] = useState('');

  const handleSubmit = () => {
    if (query.trim()) {
      onSubmit(query);
      setQuery('');
    }
  };

  return (
    <div className="space-y-4">
      <Textarea
        placeholder="Ask a new research question..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            handleSubmit();
          }
        }}
        className="glass-input min-h-[100px] resize-none text-white placeholder:text-gray-500"
        disabled={isLoading}
      />
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">
          Press {typeof navigator !== 'undefined' && navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl'}+Enter to submit
        </p>
        <Button 
          onClick={handleSubmit} 
          disabled={isLoading || !query.trim()}
          className="bg-gradient-button text-white font-semibold hover:shadow-lg"
        >
          {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isLoading ? 'Running...' : 'Ask'}
        </Button>
      </div>
    </div>
  );
}

