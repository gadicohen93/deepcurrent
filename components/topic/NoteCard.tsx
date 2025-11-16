'use client';

import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import ReactMarkdown from 'react-markdown';
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
            <ReactMarkdown
              components={{
                // Customize code blocks
                code: ({ node, inline, className, children, ...props }) => {
                  if (inline) {
                    return (
                      <code className="bg-purple-900/30 text-purple-200 px-1.5 py-0.5 rounded text-xs font-mono" {...props}>
                        {children}
                      </code>
                    );
                  }
                  return (
                    <pre className="bg-black/40 p-4 rounded-lg overflow-x-auto">
                      <code className={className} {...props}>
                        {children}
                      </code>
                    </pre>
                  );
                },
                // Style links
                a: ({ node, children, ...props }) => (
                  <a 
                    className="text-purple-400 hover:text-purple-300 underline" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    {...props}
                  >
                    {children}
                  </a>
                ),
                // Style headings
                h1: ({ node, children, ...props }) => (
                  <h1 className="text-xl font-bold text-white mb-3 mt-6" {...props}>{children}</h1>
                ),
                h2: ({ node, children, ...props }) => (
                  <h2 className="text-lg font-semibold text-white mb-2 mt-5" {...props}>{children}</h2>
                ),
                h3: ({ node, children, ...props }) => (
                  <h3 className="text-base font-medium text-white mb-2 mt-4" {...props}>{children}</h3>
                ),
                // Style lists
                ul: ({ node, children, ...props }) => (
                  <ul className="list-disc list-inside space-y-1 text-gray-300" {...props}>{children}</ul>
                ),
                ol: ({ node, children, ...props }) => (
                  <ol className="list-decimal list-inside space-y-1 text-gray-300" {...props}>{children}</ol>
                ),
                li: ({ node, children, ...props }) => (
                  <li className="text-gray-300 leading-relaxed" {...props}>{children}</li>
                ),
                // Style paragraphs
                p: ({ node, children, ...props }) => (
                  <p className="text-gray-300 leading-relaxed mb-3" {...props}>{children}</p>
                ),
                // Style blockquotes
                blockquote: ({ node, children, ...props }) => (
                  <blockquote className="border-l-4 border-purple-500/50 pl-4 py-2 my-3 italic text-gray-400" {...props}>
                    {children}
                  </blockquote>
                ),
              }}
            >
              {note.content}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}

