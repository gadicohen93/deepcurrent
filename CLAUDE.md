# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Deep Research Assistant is an advanced AI research system built on the Mastra framework. It orchestrates multiple specialized AI agents, workflows, and tools to conduct comprehensive research, generate reports, and manage GitHub projects. The system features a dual-database architecture (LibSQL), sophisticated memory processors, and a modern React frontend.

## Development Commands

### Backend (Mastra)
```bash
npm run dev                  # Start Mastra dev server (port 4111)
npm run build                # Build Mastra backend
npm run start                # Start production Mastra server
```

### Frontend (React + Vite)
```bash
npm run dev:frontend         # Start frontend dev server (port 4000)
npm run build:frontend       # Build frontend for production
npm run dev:full             # Run both backend and frontend concurrently
npm run preview              # Preview production build
```

### Testing
```bash
npm test                     # Run tests in watch mode
npm run test:ui              # Run tests with Vitest UI
npm run test:coverage        # Run tests with coverage and summary
npm run test:coverage:run    # Generate coverage reports (JSON + dot reporter)
npm run test:coverage:stream # Stream coverage with default reporter
```

### Code Quality
```bash
npm run lint                 # Run ESLint
npm run lint:fix             # Auto-fix ESLint issues
npm run format               # Format code with Prettier
npm run format:check         # Check code formatting
```

### MCP Server
```bash
npm run mcp:server          # Start MCP server for tool integration
```

## Architecture Overview

### Core Structure

```
src/
├── mastra/                 # Backend AI orchestration layer
│   ├── agents/            # 13 specialized AI agents
│   ├── workflows/         # 5 orchestrated workflows
│   ├── tools/             # Specialized tools (web, vector, GitHub, etc.)
│   ├── config/            # Storage, memory, and provider configs
│   ├── networks/          # Multi-agent collaboration networks
│   ├── mcp/              # Model Context Protocol integration
│   └── evals/            # Evaluation scorers
├── app/                   # Frontend routing and pages
├── components/            # React UI components
│   ├── ui/               # shadcn/ui components (47 total)
│   ├── layout/           # Layout components
│   └── public/           # Public-facing components
├── hooks/                # React custom hooks
└── lib/                  # Utility functions
```

### Dual Database Architecture

The system uses **two separate LibSQL databases**:

1. **Research Database** (`mastra.db`): Stores research data, conversations, and general application state
2. **Vector Database** (`vector-store.db`): Stores embeddings for semantic search via `LibSQLVector`

**Important**: When working with storage:
- The main Mastra instance uses `mastra.db` (configured in `src/mastra/index.ts`)
- Vector operations use `LibSQLVector` with separate connection to `vector-store.db`
- Memory processors in `src/mastra/config/libsql-storage.ts` create custom storage with tracing
- PostgreSQL support exists in `src/mastra/config/pg-storage.ts` as an alternative

### Agent System

All agents are defined in `src/mastra/agents/` and registered in `src/mastra/index.ts`. Key agents:

- **researchAgent**: Two-phase research (initial + follow-up) with web search, evaluation, and learning extraction
- **reportAgent**: Generates comprehensive reports from research data
- **ragAgent**: Vector search and retrieval-augmented generation
- **githubAgent**: Complete GitHub API integration via Octokit
- **monitorAgent**: System health monitoring and observability
- **planningAgent**: Strategic planning with resource allocation
- **qualityAssuranceAgent**: Software quality management and testing
- **copywriterAgent**: Content creation and copywriting
- **editorAgent**: Content editing and refinement
- **publisherAgent**: Content publishing workflows
- **webSummarizationAgent**: Web content condensation

Each agent uses:
- Google AI models (`google('gemini-2.5-flash-lite')` or similar)
- Specific tools from `src/mastra/tools/`
- Memory created via `createResearchMemory()` or similar
- Evaluation metrics from `@mastra/evals`

### Workflow Architecture

Workflows in `src/mastra/workflows/` orchestrate multi-step processes:

1. **comprehensiveResearchWorkflow**: End-to-end research with human-in-the-loop
   - Suspends for user input at specific steps
   - Resume with `resumeData` to continue workflow
   - Integrates research, evaluation, RAG, and report generation

2. **githubPlanningWorkflow**: Multi-agent GitHub project management
   - Planning agent → Monitor agent → Task generation

3. **githubQualityWorkflow**: Quality-focused GitHub workflow
   - Planning agent → QA agent analysis

**Workflow Patterns**:
- Use `createStep()` with `suspendSchema` and `resumeSchema` for human-in-the-loop
- Steps communicate via typed input/output schemas (Zod)
- Access previous step outputs via `inputData`
- Resume suspended workflows with `run.resume({ step: 'step-id', resumeData: {...} })`

### Memory Processors

Located in `src/mastra/config/memory-processors.ts`, 11 specialized processors optimize context:

**Core Processing:**
- `TokenLimiterProcessor`: Prevents context overflow
- `ErrorCorrectionProcessor`: Checksum-based deduplication
- `CircuitBreakerProcessor`: Fault tolerance

**Semantic Enhancement:**
- `PersonalizationProcessor`: User-specific content boosting
- `HierarchicalMemoryProcessor`: Episodic vs semantic memory
- `CitationExtractorProcessor`: Prioritizes cited content

**Advanced Reasoning:**
- `MultiPerspectiveProcessor`: Multi-viewpoint analysis
- `TemporalReasoningProcessor`: Time-based relationships
- `UncertaintyQuantificationProcessor`: Confidence scoring
- `KnowledgeGraphProcessor`: Knowledge graph construction
- `BayesianBeliefProcessor`: Probabilistic reasoning

**Performance Features**:
- WeakMap caching for garbage collection efficiency
- Pre-compiled regex patterns
- SIMD-like batch processing for token estimation
- Lazy evaluation with memoization

### Tool System

Tools in `src/mastra/tools/`:

**Web & Search:**
- `webSearchTool`: Intelligent web scraping via Exa API
- `web-scraper-tool`: Enhanced scraping with markdown output
- `vectorQueryTool`: Semantic search over embeddings

**RAG Pipeline:**
- `chunker-tool`: Document segmentation with overlap
- `rerank-tool`: Result relevance optimization
- `graphRAG`: Knowledge graph-based retrieval

**GitHub Integration** (`src/mastra/tools/github/`):
- 14 specialized GitHub tools (repositories, issues, PRs, branches, etc.)
- All use Octokit for GitHub API access
- Requires `GITHUB_API_KEY` environment variable

**Data Management:**
- `data-file-manager`: 8 file management operations

**Agent Tools:**
- `copywriter-agent-tool`: Wraps copywriter agent
- `editor-agent-tool`: Wraps editor agent
- `evaluateResultTool`: Content quality assessment
- `extractLearningsTool`: Insight extraction

### Frontend Integration

**Technology Stack:**
- React 19.1+ with TypeScript 5.9+
- Vite 7.1+ for build tooling
- Tailwind CSS v4.1 (CSS-first config)
- React Router v7.8+ for routing
- 47 shadcn/ui components with Radix UI primitives

**Key Files:**
- `src/app/routes.ts`: Route definitions
- `vite.config.ts`: Frontend build config (port 4000)
- `src/lib/utils.ts`: Utility functions (cn, etc.)

**Integration Points:**
- Frontend communicates with Mastra backend via `VITE_MASTRA_API_URL` (default: http://localhost:4111)
- Use Mastra client library for API calls
- Real-time workflow monitoring and agent interactions

## Environment Configuration

Required environment variables (see `.env.example`):

**Core:**
- `GOOGLE_GENERATIVE_AI_API_KEY`: Required for all AI operations
- `DATABASE_URL`: LibSQL URL (default: `file:./mastra.db`)
- `VECTOR_DATABASE_URL`: Vector store URL (default: `file:./vector-store.db`)

**Optional Services:**
- `EXA_API_KEY`: For web search tool
- `GITHUB_API_KEY`: For GitHub agent and tools
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`: For Supabase integration
- `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`: For observability
- `OPENROUTER_API_KEY`: For assistant agent

**Frontend:**
- `VITE_MASTRA_API_URL`: Mastra backend URL (default: http://localhost:4111)
- `NODE_ENV`: development or production

## Testing Architecture

**Configuration** (`vitest.config.ts`):
- Tests use `jsdom` environment
- Global setup in `globalSetup.ts`, test setup in `testSetup.ts`
- Tests located in `src/**/*.test.ts`, `src/**/*.spec.ts`, or `tests/`
- Coverage reports in `docs/test-results/coverage/`
- 10-second timeout for tests and hooks

**Test Patterns**:
- Colocated tests next to source files (e.g., `agents/index.test.ts`)
- Integration tests in `tests/` directory
- Coverage thresholds can be configured in `vitest.config.ts`

## Observability & Tracing

**OpenTelemetry Integration:**
- Configured in `src/mastra/index.ts` with Langfuse exporter
- Tracing utilities in `src/mastra/ai-tracing.ts`
- Child spans for detailed operation tracking
- Custom span attributes for debugging

**Logging:**
- Uses `PinoLogger` from `@mastra/loggers`
- Configure log level in logger instances (default: 'warn' in main, 'info' in agents)
- Optional file transport available

## Important Implementation Notes

### When Adding New Agents:
1. Create agent file in `src/mastra/agents/`
2. Use `createResearchMemory()` or similar for memory
3. Configure with Google AI model and specific tools
4. Add evaluation metrics as needed
5. Register in `src/mastra/index.ts` agents object
6. Export from `src/mastra/agents/index.ts`

### When Adding New Workflows:
1. Create workflow file in `src/mastra/workflows/`
2. Use `createWorkflow()` and `createStep()`
3. Define input/output schemas with Zod
4. Use `suspendSchema`/`resumeSchema` for human-in-the-loop
5. Register in `src/mastra/index.ts` workflows object

### When Adding New Tools:
1. Create tool file in `src/mastra/tools/`
2. Use Mastra's `createTool()` or similar patterns
3. Define input/output schemas
4. Add error handling and logging
5. Register in agent's tools object

### Storage Considerations:
- Two databases: use correct one for each operation
- Vector operations require separate LibSQLVector instance
- Memory processors are applied in `createResearchMemory()`
- Tracing context flows through storage operations

### Research Agent Workflow:
- **Phase 1**: Initial 2-3 queries → evaluate → extract learnings
- **Phase 2**: Search follow-up questions from Phase 1 → STOP
- Do NOT create infinite loops by searching Phase 2 follow-ups
- Always return JSON with queries, searchResults, learnings, completedQueries, phase

### GitHub Integration:
- All GitHub tools require `GITHUB_API_KEY`
- Tools use Octokit client from `src/mastra/tools/github/octokit.ts`
- Comprehensive error handling and logging built-in
- Copilot features require GitHub Copilot Enterprise subscription

## Common Patterns

**Accessing Mastra Instance:**
```typescript
import { mastra } from './src/mastra';
const agent = mastra.getAgent('researchAgent');
const workflow = mastra.getWorkflow('comprehensiveResearchWorkflow');
```

**Creating Memory with Processors:**
```typescript
import { createResearchMemory } from './src/mastra/config/libsql-storage';
const memory = createResearchMemory();
```

**Running Workflows:**
```typescript
const workflow = mastra.getWorkflow('comprehensive-research-workflow');
const run = await workflow.createRunAsync();
let result = await run.start({ inputData: {} });

// Handle suspension
if (result.status === 'suspended') {
  result = await run.resume({
    step: 'get-user-query',
    resumeData: { query: 'quantum computing' }
  });
}
```

## Path Aliases

TypeScript path alias `@/*` resolves to `./src/*` (configured in `tsconfig.json` and `vite.config.ts`).

```typescript
import { utils } from '@/lib/utils';
import { researchAgent } from '@/mastra/agents/researchAgent';
```
