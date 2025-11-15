# DeepCurrent - Self-Evolving Research OS

A minimal, polished web UI for DeepCurrent, a self-evolving research operating system that adapts its research strategies based on performance metrics.

## Overview

DeepCurrent is **not a chat app**. It's a research workspace featuring:

- **Topic Management**: Organize research into distinct topics
- **Research Stream**: Query input and notes display in a clean, card-based interface
- **Agent Brain Panel**: Real-time view of active strategy, performance metrics, and evolution history
- **Strategy Replay**: Side-by-side comparison of different strategy versions

## Tech Stack

- **Framework**: Next.js 15 with App Router
- **UI**: React 19 + Tailwind CSS
- **Components**: shadcn/ui
- **State**: Client-side React state (ready for backend integration)
- **Data**: Mock data for demonstration (structured for easy API swap)

## Project Structure

```
deep-research/
├── app/                          # Next.js App Router
│   ├── layout.tsx               # Root layout
│   ├── page.tsx                 # Home (redirects to /topics)
│   ├── globals.css              # Global styles & CSS variables
│   └── topics/
│       ├── page.tsx             # Topic list
│       └── [id]/
│           ├── page.tsx         # Topic workspace (main view)
│           └── replay/
│               └── page.tsx     # Strategy comparison/replay
├── components/
│   ├── agent/
│   │   └── AgentBrainPanel.tsx  # Strategy metrics & evolution display
│   ├── topic/
│   │   ├── NoteCard.tsx         # Research note card
│   │   ├── QueryInput.tsx       # Research query input
│   │   └── TopicSidebar.tsx     # Topic navigation sidebar
│   └── ui/                       # shadcn/ui components
├── lib/
│   └── mockData.ts              # Mock data & type definitions
└── package.json
```

## Data Model

### Types

```typescript
type StrategyConfigPayload = {
  version: number;
  status: "active" | "candidate" | "archived";
  rolloutPercentage: number;
  tools: string[];
  sensoFirst: boolean;
  summaryTemplates: ("bullets" | "comparison" | "narrative" | "prd")[];
  timeWindow: "day" | "week" | "month" | "all";
  searchDepth: "shallow" | "deep";
  fitness?: number;
  metrics?: {
    episodes: number;
    saveRate: number;
    sensoReuseRate: number;
    followupPenalty: number;
  };
};

type Note = {
  id: string;
  topicId: string;
  title: string;
  content: string;
  type: "research" | "update";
  createdAt: string;
};

type Topic = {
  id: string;
  title: string;
  description?: string;
  watchEnabled: boolean;
  activeStrategyVersion: number;
  strategies: StrategyConfigPayload[];
  notes: Note[];
  evolutionLogs: Array<{
    id: string;
    fromVersion?: number;
    toVersion: number;
    createdAt: string;
    summary: string;
  }>;
};
```

## Pages

### 1. `/topics` - Topic List

- Displays all available topics
- Shows active strategy version and key metrics
- Click any topic card to navigate to its workspace

### 2. `/topics/[id]` - Topic Workspace (Main View)

**Layout: 3 columns**

#### Left Sidebar
- Back navigation
- Topic metadata (note count, strategy count)

#### Center Column - Research Stream
- **Query Input**: Ask research questions
  - Textarea with submit button
  - Keyboard shortcut (Cmd/Ctrl + Enter)
  - Loading state with spinner
- **Notes List**: Expandable cards showing research results
  - Title, type badge, timestamp
  - Expandable content
  - Newest first

#### Right Column - Agent Brain
- **Current Strategy**: Active strategy details
  - Version and status
  - Tools, templates, configuration
- **Performance Metrics**: Real-time stats
  - Episodes, save rate, fitness score
  - Senso reuse rate, follow-up penalty
- **Strategy Versions**: All versions with comparison
  - Fitness trends (up/down arrows)
  - Status badges
  - Link to replay view
- **Evolution Log**: Recent strategy changes
  - Version transitions
  - Human-readable summaries

### 3. `/topics/[id]/replay` - Strategy Replay

**Side-by-side comparison of two strategies**

- Dropdown selectors for Strategy A and Strategy B
- Query input for comparison
- **Two-column layout** showing:
  - Strategy metadata (tools, config)
  - Mock response based on strategy settings
- **Differences Summary**: Key changes between strategies
  - Tool additions/removals
  - Configuration changes
  - Fitness improvements

## Getting Started

### Installation

```bash
# Install dependencies
npm install

# Run the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) - you'll be redirected to `/topics`.

### Running with Mastra Backend

```bash
# Run both frontend and Mastra backend
npm run dev:full
```

This runs:
- Next.js dev server on port 3000
- Mastra backend (if configured)

## Mock Data

Currently, all data is mocked in `lib/mockData.ts`:

- **1 Topic**: "Self-Evolving Agents"
- **3 Strategies**: v0 (archived), v1 (active), v2 (candidate)
- **5 Notes**: Mix of research and update types
- **2 Evolution Logs**: Strategy transition records

### Local State Management

The workspace uses React state to simulate behavior:

```typescript
// In Topic Workspace
const [notes, setNotes] = useState(topic.notes);
const [watchEnabled, setWatchEnabled] = useState(topic.watchEnabled);

// When user asks a question
const handleQuery = async (query: string) => {
  // Show loading state
  setIsQuerying(true);
  
  // Simulate delay
  await new Promise(resolve => setTimeout(resolve, 1500));
  
  // Create mock note
  const newNote = { /* ... */ };
  setNotes([newNote, ...notes]);
  
  setIsQuerying(false);
};
```

## Backend Integration (Future)

The frontend is structured for easy API integration:

```typescript
// Replace mock data with API calls
import { getTopicById } from '@/lib/mockData';  // Current
import { getTopicById } from '@/lib/api';       // Future

// In page components
const topic = await fetch(`/api/topics/${id}`).then(r => r.json());

// In QueryInput submit
const result = await fetch('/api/query', {
  method: 'POST',
  body: JSON.stringify({ topicId, query }),
});
```

## Visual Design

- **Minimal & Clean**: Focus on content, not chrome
- **Card-Based Layout**: Clear visual hierarchy
- **Neutral Colors**: Light background with subtle borders
- **Accent Color**: Blue for interactive elements
- **Typography**: Clear hierarchy (xl → lg → md → sm)
- **Responsive**: Mobile-friendly with column stacking

### Color Scheme

Using CSS variables defined in `app/globals.css`:
- Background: Clean white/dark
- Primary: Blue (#3B82F6)
- Muted: Gray for secondary content
- Borders: Subtle (#E5E7EB)

## Key Features

### 1. Interactive Query

- Type a research question
- Click "Ask" or use keyboard shortcut
- Loading spinner appears
- New note prepends to list with mock content

### 2. Strategy Evolution Tracking

- View all strategy versions
- Compare fitness scores
- See what changed between versions
- Evolution log explains each transition

### 3. Strategy Replay

- Select two strategies to compare
- Enter a query
- See side-by-side results based on:
  - Different tools
  - Different templates
  - Different configurations
- Review key differences

### 4. Watch Mode

- Toggle in header
- (Future) Subscribe to automatic updates
- (Future) Background monitoring

## Component Library

Uses shadcn/ui components (already included in your project):

- `Badge`: Status indicators, tool chips
- `Button`: Actions, navigation
- `Card`: Content containers
- `Input`: Text input for replay
- `Label`: Form labels
- `Select`: Strategy version selectors
- `Separator`: Visual dividers
- `Switch`: Watch mode toggle
- `Textarea`: Query input

## Development Notes

### Adding a New Topic

Edit `lib/mockData.ts`:

```typescript
export const mockTopics: Topic[] = [
  // ... existing topic
  {
    id: "2",
    title: "New Topic",
    description: "Description here",
    watchEnabled: false,
    activeStrategyVersion: 0,
    strategies: [/* ... */],
    notes: [],
    evolutionLogs: [],
  },
];
```

### Customizing Strategy Display

Edit `components/agent/AgentBrainPanel.tsx` to change how strategies are visualized.

### Styling

- Global styles: `app/globals.css`
- Tailwind config: `tailwind.config.ts`
- Component-specific: Inline Tailwind classes

## Scripts

```bash
# Development
npm run dev              # Next.js dev server
npm run dev:mastra       # Mastra backend only
npm run dev:full         # Both frontend + backend

# Production
npm run build            # Build for production
npm start                # Start production server

# Code Quality
npm run lint             # Run ESLint
npm run format           # Format with Prettier
npm test                 # Run tests
```

## Next Steps

1. **Backend Integration**: Replace mock data with real API calls
2. **Real-time Updates**: WebSocket for live strategy updates
3. **Authentication**: User accounts and private topics
4. **Persistence**: Save notes and user preferences
5. **Advanced Replay**: Historical query replays with real data
6. **Notifications**: Alert on strategy promotions/demotions
7. **Analytics**: Deeper performance insights and charts

## License

ISC

---

**Built with Next.js, React, and Tailwind CSS**

