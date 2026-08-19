import { useCallback, useEffect, useState } from 'react';
import dagre from 'dagre';
import { AnimatePresence, motion } from 'framer-motion';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

SyntaxHighlighter.registerLanguage('python', python);
SyntaxHighlighter.registerLanguage('javascript', javascript);
SyntaxHighlighter.registerLanguage('typescript', typescript);
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import GraphNode, { type GraphNodeData } from './components/GraphNode';
import ExternalGroupNode from './components/ExternalGroupNode';
import FolderGroupNode from './components/FolderGroupNode';
import GraphEdge, { type GraphEdgeData } from './components/GraphEdge';
import ChatPanel, { type ChatScope } from './components/ChatPanel';
import { API_BASE_URL, extractErrorMessage } from './lib/api';

const NODE_WIDTH = 175;
const NODE_HEIGHT = 50;
const FOLDER_PADDING = 48;
const FOLDER_HEADER = 36;

// Registered once at module scope - React Flow re-renders every node/edge if
// these object identities change, so they must never be recreated inside the component.
const nodeTypes = { graphNode: GraphNode, externalGroup: ExternalGroupNode, folderGroup: FolderGroupNode };
const edgeTypes = { graphEdge: GraphEdge };

const getLayoutedElements = <T extends Node>(nodes: T[], edges: Edge[], direction = 'TB') => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: direction, nodesep: 60, ranksep: 90 });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - NODE_WIDTH / 2,
        y: nodeWithPosition.y - NODE_HEIGHT / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
};

// A file's folder groups it visually; the external-deps node gets its own
// pseudo-folder so it never gets boxed in with real source files.
const folderKey = (node: Node<GraphNodeData>): string =>
  node.data.type === 'external-group' ? '__external__' : node.data.folder || '(root)';

// Two-level layout so large repos don't render as one flat, illegible mess:
// 1. lay out each folder's members locally (reusing the plain dagre pass above)
// 2. lay out the folders themselves as a coarse graph, sized to fit their contents
// 3. place each folder's local layout inside its allotted box
const getClusteredLayout = (nodes: Node<GraphNodeData>[], edges: Edge<GraphEdgeData>[]) => {
  if (nodes.length === 0) return { nodes, edges };

  const groups = new Map<string, Node<GraphNodeData>[]>();
  nodes.forEach((n) => {
    const key = folderKey(n);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(n);
  });

  const localLayouts = new Map<string, { nodes: Node<GraphNodeData>[]; width: number; height: number }>();

  groups.forEach((members, key) => {
    const memberIds = new Set(members.map((m) => m.id));
    const internalEdges = edges.filter((e) => memberIds.has(e.source) && memberIds.has(e.target));
    const { nodes: laidOut } = getLayoutedElements(members, internalEdges);

    const minX = Math.min(...laidOut.map((n) => n.position.x));
    const minY = Math.min(...laidOut.map((n) => n.position.y));
    const maxX = Math.max(...laidOut.map((n) => n.position.x + NODE_WIDTH));
    const maxY = Math.max(...laidOut.map((n) => n.position.y + NODE_HEIGHT));

    localLayouts.set(key, {
      nodes: laidOut.map((n) => ({ ...n, position: { x: n.position.x - minX, y: n.position.y - minY } })),
      width: maxX - minX,
      height: maxY - minY,
    });
  });

  const folderGraph = new dagre.graphlib.Graph();
  folderGraph.setDefaultEdgeLabel(() => ({}));
  folderGraph.setGraph({ rankdir: 'TB', nodesep: 140, ranksep: 180 });

  groups.forEach((_, key) => {
    const layout = localLayouts.get(key)!;
    folderGraph.setNode(key, {
      width: layout.width + FOLDER_PADDING * 2,
      height: layout.height + FOLDER_PADDING * 2 + FOLDER_HEADER,
    });
  });

  const seenFolderEdges = new Set<string>();
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  edges.forEach((e) => {
    const sourceNode = nodeById.get(e.source);
    const targetNode = nodeById.get(e.target);
    if (!sourceNode || !targetNode) return;
    const sk = folderKey(sourceNode);
    const tk = folderKey(targetNode);
    if (sk === tk) return;
    const edgeKey = `${sk}->${tk}`;
    if (seenFolderEdges.has(edgeKey)) return;
    seenFolderEdges.add(edgeKey);
    folderGraph.setEdge(sk, tk);
  });

  dagre.layout(folderGraph);

  const finalNodes: Node[] = [];
  groups.forEach((_, key) => {
    const pos = folderGraph.node(key);
    const layout = localLayouts.get(key)!;
    const boxX = pos.x - pos.width / 2;
    const boxY = pos.y - pos.height / 2;

    // Only draw a visible cluster box when there's more than one group to
    // distinguish - a single-folder repo doesn't need a box around everything.
    if (key !== '__external__' && groups.size > 1) {
      finalNodes.push({
        id: `group::${key}`,
        type: 'folderGroup',
        position: { x: boxX, y: boxY },
        data: { label: key === '(root)' ? '/ (root)' : key },
        style: { width: pos.width, height: pos.height },
        selectable: false,
        draggable: false,
        zIndex: -1,
      });
    }

    layout.nodes.forEach((n) => {
      finalNodes.push({
        ...n,
        position: {
          x: boxX + FOLDER_PADDING + n.position.x,
          y: boxY + FOLDER_PADDING + FOLDER_HEADER + n.position.y,
        },
      });
    });
  });

  return { nodes: finalNodes, edges };
};

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
      className="cursor-pointer rounded-md px-2 py-1 text-[11px] text-[var(--color-muted)] hover:bg-white/10 hover:text-white focus:outline-none"
    >
      {copied ? 'Copied ✓' : 'Copy'}
    </button>
  );
}

const SYNTAX_LANGUAGE: Record<string, string> = {
  python: 'python',
  javascript: 'javascript',
  typescript: 'typescript',
};

// 1. Initial "chumma" mock data so the canvas isn't empty on load
const mockNodes: Node<GraphNodeData>[] = [
  { id: '1', type: 'graphNode', position: { x: 0, y: 0 }, data: { label: 'main.py', type: 'file', language: 'python' } },
  { id: '2', type: 'graphNode', position: { x: 0, y: 0 }, data: { label: 'api.py', type: 'file', language: 'python' } },
  { id: '3', type: 'graphNode', position: { x: 0, y: 0 }, data: { label: 'database.py', type: 'file', language: 'python' } },
  { id: '4', type: 'graphNode', position: { x: 0, y: 0 }, data: { label: 'models.py', type: 'file', language: 'python' } },
  { id: '5', type: 'graphNode', position: { x: 0, y: 0 }, data: { label: 'utils.py', type: 'file', language: 'python' } },
];

const mockEdges: Edge<GraphEdgeData>[] = [
  { id: 'e1-2', source: '1', target: '2', type: 'graphEdge', data: { kind: 'imports' } },
  { id: 'e1-3', source: '1', target: '3', type: 'graphEdge', data: { kind: 'imports' } },
  { id: 'e2-4', source: '2', target: '4', type: 'graphEdge', data: { kind: 'imports' } },
  { id: 'e3-4', source: '3', target: '4', type: 'graphEdge', data: { kind: 'imports' } },
  { id: 'e4-5', source: '4', target: '5', type: 'graphEdge', data: { kind: 'imports' } },
];

const { nodes: initialNodes, edges: initialEdges } = getClusteredLayout(mockNodes, mockEdges);

export default function App() {
  const [nodes, setNodes] = useState<Node[]>(initialNodes);
  const [edges, setEdges] = useState<Edge[]>(initialEdges);

  const [repoUrl, setRepoUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  // Set once /analyze succeeds - scopes chat retrieval and embeddings to this repo.
  const [jobId, setJobId] = useState<string | null>(null);

  // Interactive Code Inspector Panel
  const [selectedNode, setSelectedNode] = useState<Node<GraphNodeData> | null>(null);

  // Toast auto-dismiss for analyze errors
  useEffect(() => {
    if (!analyzeError) return;
    const timer = setTimeout(() => setAnalyzeError(null), 7000);
    return () => clearTimeout(timer);
  }, [analyzeError]);

  // Clicking a real file node scopes the chat to that file; external-dep and
  // folder nodes have no single source file to scope a conversation to.
  const chatScope: ChatScope =
    selectedNode && selectedNode.data.type === 'file'
      ? { id: selectedNode.id, label: selectedNode.data.label }
      : null;

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );

  const onConnect = useCallback((params: Connection) => setEdges((eds) => addEdge(params, eds)), []);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.type === 'folderGroup') return;
    setSelectedNode(node as Node<GraphNodeData>);
  }, []);

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrl) return;

    setIsLoading(true);
    setSelectedNode(null);
    setAnalyzeError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo_url: repoUrl }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(extractErrorMessage(body, response.status));
      }

      const data = await response.json();

      if (data.nodes.length === 0) {
        throw new Error(
          'No Python, JavaScript, or TypeScript files were found in this repo - nothing to visualize.'
        );
      }

      // Backend nodes all arrive at position (0, 0) - the clustered layout
      // computes real, folder-grouped, non-overlapping coordinates.
      const rawNodes: Node<GraphNodeData>[] = data.nodes.map((node: { id: string; data: GraphNodeData }) => ({
        ...node,
        type: node.data.type === 'external-group' ? 'externalGroup' : 'graphNode',
      }));
      const rawEdges: Edge<GraphEdgeData>[] = data.edges.map(
        (edge: { id: string; source: string; target: string; type: string; calls?: string[]; packages?: string[] }) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: 'graphEdge',
          data: { kind: edge.type, calls: edge.calls, packages: edge.packages },
        })
      );

      const layouted = getClusteredLayout(rawNodes, rawEdges);
      setNodes(layouted.nodes);
      setEdges(layouted.edges);
      setJobId(data.job_id);
    } catch (error) {
      console.error('Failed to analyze repository:', error);
      setAnalyzeError(error instanceof Error ? error.message : 'Failed to analyze the repository.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-screen flex-col" style={{ width: '100vw', height: '100vh' }}>
      {/* Shared SVG defs for the gradient edge stroke */}
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <linearGradient id="graph-edge-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#a78bfa" />
          </linearGradient>
        </defs>
      </svg>

      {/* Navbar with Search Form */}
      <header className="glass-panel z-30 flex h-16 w-full shrink-0 items-center justify-between border-x-0 border-t-0 px-5">
        <h1 className="gradient-text m-0 text-lg font-bold tracking-tight">RepoSense</h1>

        <form onSubmit={handleAnalyze} className="flex w-1/3 min-w-[320px] gap-2">
          <div className="relative flex-1">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-muted)]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="url"
              placeholder="https://github.com/user/repo"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-white/[0.03] py-1.5 pl-9 pr-3 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-muted)] transition-colors focus:border-cyan-300/50 focus:outline-none focus:ring-2 focus:ring-cyan-300/20"
              required
            />
          </div>
          <button
            type="submit"
            disabled={isLoading}
            className="rounded-lg bg-gradient-to-r from-cyan-400 to-violet-400 px-4 py-1.5 text-sm font-semibold text-slate-900 transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {isLoading ? 'Analyzing…' : 'Analyze'}
          </button>
        </form>
      </header>

      {/* Toast-style error notification */}
      <AnimatePresence>
        {analyzeError && (
          <motion.div
            initial={{ opacity: 0, y: -12, x: 20 }}
            animate={{ opacity: 1, y: 0, x: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="glass-panel fixed right-5 top-20 z-40 flex max-w-sm items-start gap-3 rounded-xl border-l-2 border-l-red-400 px-4 py-3 text-sm text-red-200 shadow-2xl"
          >
            <span className="flex-1">{analyzeError}</span>
            <button
              onClick={() => setAnalyzeError(null)}
              className="cursor-pointer text-red-300/70 hover:text-red-200 focus:outline-none"
            >
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content Area */}
      <div className="relative w-full flex-1 overflow-hidden">
        <div className="h-full w-full transition-all duration-300 ease-in-out" style={{ width: selectedNode ? '66.6667%' : '100%' }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} color="rgba(255,255,255,0.08)" gap={22} size={1} />
            <Controls className="!border-white/10 !bg-[#0d0d16]/80 [&_button]:!border-white/10 [&_button]:!bg-transparent [&_button]:!fill-white [&_button]:!text-white [&_button:hover]:!bg-white/10" />
          </ReactFlow>

          {/* Skeleton loading overlay while /analyze is in flight */}
          <AnimatePresence>
            {isLoading && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-20 flex items-center justify-center bg-[var(--color-void)]/70 backdrop-blur-sm"
              >
                <div className="glass-panel flex flex-col items-center gap-4 rounded-2xl px-10 py-8">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    className="h-10 w-10 rounded-full border-2 border-white/10"
                    style={{ borderTopColor: '#22d3ee', borderRightColor: '#a78bfa' }}
                  />
                  <p className="text-sm text-[var(--color-muted)]">Cloning, parsing &amp; embedding the repo…</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Interactive Code Inspector Sidebar */}
        <AnimatePresence>
          {selectedNode && (
            <motion.div
              initial={{ x: '100%', opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 260 }}
              className="glass-panel absolute right-0 top-0 z-10 flex h-full w-1/3 flex-col border-y-0 border-r-0 shadow-2xl"
            >
              {/* Sticky header: breadcrumb + copy */}
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-white/[0.02] px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-[var(--color-ink)]" title={String(selectedNode.data.label)}>
                    {String(selectedNode.data.label)}
                  </div>
                  {selectedNode.data.type === 'file' && selectedNode.data.folder !== undefined && (
                    <div className="truncate text-[11px] text-[var(--color-muted)]">
                      /{selectedNode.data.folder || ''}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {selectedNode.data.type === 'file' && selectedNode.data.code && (
                    <CopyButton key={selectedNode.id} code={String(selectedNode.data.code)} />
                  )}
                  <button
                    onClick={() => setSelectedNode(null)}
                    className="cursor-pointer text-[var(--color-muted)] hover:text-white focus:outline-none"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* Body: source code or dependency list */}
              <div className="flex-1 overflow-y-auto">
                {selectedNode.data.type === 'external-group' ? (
                  <div className="p-4">
                    <p className="mb-3 text-xs text-[var(--color-muted)]">
                      {(selectedNode.data.dependencies ?? []).length} external package
                      {(selectedNode.data.dependencies ?? []).length === 1 ? '' : 's'} referenced across this repo:
                    </p>
                    <ul className="space-y-1.5">
                      {(selectedNode.data.dependencies ?? []).map((dep) => (
                        <li
                          key={dep}
                          className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 font-mono text-xs text-slate-300"
                        >
                          {dep}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <SyntaxHighlighter
                    language={SYNTAX_LANGUAGE[selectedNode.data.language ?? ''] ?? 'text'}
                    style={oneDark}
                    showLineNumbers
                    wrapLongLines
                    customStyle={{ margin: 0, background: 'transparent', fontSize: '12.5px', padding: '16px' }}
                  >
                    {selectedNode.data.code ? String(selectedNode.data.code) : '# No source available for this node'}
                  </SyntaxHighlighter>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <ChatPanel
        key={jobId ?? 'initial'}
        jobId={jobId}
        scope={chatScope}
        onCitationClick={(filePath) => {
          const node = nodes.find((n) => n.id === filePath && n.type !== 'folderGroup');
          if (node) setSelectedNode(node as Node<GraphNodeData>);
        }}
      />
    </div>
  );
}
