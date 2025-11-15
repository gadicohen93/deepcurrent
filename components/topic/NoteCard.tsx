'use client';

import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Note } from '@/lib/mockData';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface NoteCardProps {
  note: Note;
}

export function NoteCard({ note }: NoteCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Clean up the title - remove "Answer:" prefix if present
  const cleanTitle = note.title.replace(/^Answer:\s*/i, '').trim();
  const excerpt = note.content.split('\n').slice(0, 2).join(' ').substring(0, 150);
  const timeAgo = formatDistanceToNow(new Date(note.createdAt), { addSuffix: true });

  return (
    <div className="glass-card rounded-2xl overflow-hidden hover:border-purple-500/20 transition-all">
      <div className="p-5" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="flex items-start justify-between gap-4 cursor-pointer">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <Badge 
                className={
                  note.type === 'research' 
                    ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30 text-xs' 
                    : 'bg-blue-500/20 text-blue-300 border-blue-500/30 text-xs'
                }
              >
                {note.type === 'research' ? '🔬 Research' : '⚙️ Update'}
              </Badge>
              <span className="text-xs text-gray-500">{timeAgo}</span>
            </div>
            <h3 className="text-base font-medium text-white mb-2 leading-snug">{cleanTitle}</h3>
            {!isExpanded && (
              <p className="text-sm text-gray-400 line-clamp-2 leading-relaxed">{excerpt}...</p>
            )}
          </div>
          <button className="text-gray-500 hover:text-white transition-colors mt-1">
            {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
        </div>
      </div>
      {isExpanded && (
        <div className="px-5 pb-5 pt-0 border-t border-white/5">
          <div className="prose prose-sm max-w-none prose-invert mt-4">
            <pre className="whitespace-pre-wrap text-sm text-gray-300 leading-relaxed font-sans">{note.content}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

