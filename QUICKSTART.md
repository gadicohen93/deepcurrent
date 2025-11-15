# DeepCurrent - Quick Start Guide

## Installation

```bash
# Install dependencies
npm install
```

## Running the App

### Option 1: Frontend Only (Recommended for first run)

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000)

You'll see:
1. **Topics List** - One topic: "Self-Evolving Agents"
2. **Click the topic** to enter the workspace
3. **Ask a question** in the query input
4. **Watch** a mock note appear after 1.5 seconds
5. **Explore** the Agent Brain panel on the right
6. **Click "Replay"** to compare strategy versions

### Option 2: Full Stack (Frontend + Mastra Backend)

```bash
npm run dev:full
```

This runs both:
- Next.js frontend on `localhost:3000`
- Mastra backend (if configured)

## What You'll See

### 1. Topics List (`/topics`)
- Card showing "Self-Evolving Agents" topic
- Active strategy: v1
- 5 notes, 3 strategies
- 65% save rate

### 2. Topic Workspace (`/topics/1`)

**Left Sidebar:**
- Back button
- Topic summary

**Center (Research Stream):**
- Query input box
- 5 existing notes (expandable cards)
- Ask a new question to add more

**Right (Agent Brain):**
- Current Strategy (v1 Active)
  - Tools: Airia, Senso, Raindrop
  - Senso-first: On
  - Deep search
- Performance metrics
  - 127 episodes
  - 65% save rate
  - 0.78 fitness
- Strategy versions list
  - v0 (archived) - 0.62 fitness
  - v1 (active) - 0.78 fitness
  - v2 (candidate) - 0.82 fitness
- Evolution log

### 3. Replay View (`/topics/1/replay`)
- Select two strategies to compare
- Enter a research question
- See side-by-side mock responses
- Review key differences

## Try This

1. **Ask a question:**
   - Go to workspace
   - Type: "What are the best practices for agent memory?"
   - Press Cmd/Ctrl+Enter or click "Ask"
   - Watch a new note appear at the top

2. **Compare strategies:**
   - Click "Replay" button in Agent Brain panel
   - Keep v0 and v1 selected
   - Modify the query
   - Click "Run Replay"
   - See how different strategies would respond

3. **Explore notes:**
   - Click any note card to expand
   - Read the full content
   - Click again to collapse

## Mock Data Behavior

All interactions are **client-side only**:

- **Ask query**: Creates a fake note after 1.5s delay
- **Watch toggle**: Updates local state
- **Replay**: Shows static mock comparisons
- **No backend calls**: Everything runs in the browser

## Project Structure

```
app/
├── layout.tsx          # Root layout
├── page.tsx            # Home (redirects to /topics)
└── topics/
    ├── page.tsx        # Topic list
    └── [id]/
        ├── page.tsx    # Workspace
        └── replay/
            └── page.tsx # Replay view

components/
├── agent/
│   └── AgentBrainPanel.tsx
└── topic/
    ├── NoteCard.tsx
    ├── QueryInput.tsx
    └── TopicSidebar.tsx

lib/
└── mockData.ts         # All mock data
```

## Customization

### Change Mock Data

Edit `lib/mockData.ts`:

```typescript
export const mockTopics: Topic[] = [
  {
    id: "1",
    title: "Your Topic Name",
    // ... customize
  }
];
```

### Add New Topics

```typescript
export const mockTopics: Topic[] = [
  // existing topic...
  {
    id: "2",
    title: "New Topic",
    strategies: [...],
    notes: [...],
  }
];
```

### Styling

All styles use Tailwind CSS. Key files:
- `app/globals.css` - CSS variables & global styles
- `tailwind.config.ts` - Tailwind configuration
- Components use inline Tailwind classes

## Next Steps

### Ready for Backend?

Replace mock data calls with API calls:

```typescript
// Before (mock)
import { getTopicById } from '@/lib/mockData';
const topic = getTopicById(id);

// After (API)
const topic = await fetch(`/api/topics/${id}`).then(r => r.json());
```

### Add Features

1. **Persistence**: Save notes to database
2. **Real Strategy Evolution**: Connect to Mastra backend
3. **User Accounts**: Authentication & authorization
4. **Real-time Updates**: WebSocket for live strategy changes
5. **Advanced Analytics**: Charts and metrics visualization

## Troubleshooting

### Port 3000 already in use

```bash
# Kill the process on port 3000
lsof -ti:3000 | xargs kill -9

# Or use a different port
PORT=3001 npm run dev
```

### Missing dependencies

```bash
npm install
```

### Build errors

```bash
# Clean install
rm -rf node_modules package-lock.json .next
npm install
npm run dev
```

## Tech Stack

- **Next.js 15** - React framework with App Router
- **React 19** - UI library
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **shadcn/ui** - Component library
- **date-fns** - Date formatting
- **Lucide React** - Icons

## Questions?

See the full documentation in `DEEPCURRENT_README.md`

---

**Enjoy exploring DeepCurrent! 🚀**

