import { useState, useCallback } from 'react';
import dagre from 'dagre';
import {
  ReactFlow,
  Background,
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
import ChatPanel, { type ChatScope } from './components/ChatPanel';
import { API_BASE_URL, extractErrorMessage } from './lib/api';

const NODE_WIDTH = 175;
const NODE_HEIGHT = 50;

// Registered once at module scope - React Flow re-renders every node if this
// object identity changes, so it must never be recreated inside the component.
const nodeTypes = { graphNode: GraphNode };

// The function that calculates non-overlapping coordinates. A fresh dagre
// graph is built on every call so layouts from a previous /analyze run never
// bleed into the next one (node/edge counts differ between repos).
const getLayoutedElements = <T extends Node>(nodes: T[], edges: Edge[], direction = 'TB') => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: direction });

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

// 1. Initial "chumma" mock data so the canvas isn't empty on load
const mockNodes: Node<GraphNodeData>[] = [
  { id: '1', type: 'graphNode', position: { x: 0, y: 0 }, data: { label: 'main.py', type: 'file', language: 'python' } },
  { id: '2', type: 'graphNode', position: { x: 0, y: 0 }, data: { label: 'api.py', type: 'file', language: 'python' } },
  { id: '3', type: 'graphNode', position: { x: 0, y: 0 }, data: { label: 'database.py', type: 'file', language: 'python' } },
  { id: '4', type: 'graphNode', position: { x: 0, y: 0 }, data: { label: 'models.py', type: 'file', language: 'python' } },
  { id: '5', type: 'graphNode', position: { x: 0, y: 0 }, data: { label: 'utils.py', type: 'file', language: 'python' } },
];

const mockEdges: Edge[] = [
  { id: 'e1-2', source: '1', target: '2' },
  { id: 'e1-3', source: '1', target: '3' },
  { id: 'e2-4', source: '2', target: '4' },
  { id: 'e3-4', source: '3', target: '4' },
  { id: 'e4-5', source: '4', target: '5' },
];

const { nodes: initialNodes, edges: initialEdges } = getLayoutedElements(mockNodes, mockEdges);

export default function App() {
  const [nodes, setNodes] = useState<Node<GraphNodeData>[]>(initialNodes);
  const [edges, setEdges] = useState<Edge[]>(initialEdges);

  const [repoUrl, setRepoUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  // Set once /analyze succeeds - scopes chat retrieval and embeddings to this repo.
  const [jobId, setJobId] = useState<string | null>(null);

  // Phase 2: State for the Code Inspector Panel
  const [selectedNode, setSelectedNode] = useState<Node<GraphNodeData> | null>(null);

  // Clicking a file node also scopes the chat to that file; external
  // (non-file) nodes have no source to scope a conversation to.
  const chatScope: ChatScope =
    selectedNode && selectedNode.data.type === 'file'
      ? { id: selectedNode.id, label: selectedNode.data.label }
      : null;

  const onNodesChange = useCallback(
    (changes: NodeChange<Node<GraphNodeData>>[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  );
  
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );
  
  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    []
  );

  // Phase 2: Handle click event to populate the sidebar
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node<GraphNodeData>) => {
    setSelectedNode(node);
  }, []);

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrl) return;

    setIsLoading(true);
    setSelectedNode(null); // Close sidebar on new analysis
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

      // Backend nodes all arrive at position (0, 0) - dagre computes real,
      // non-overlapping coordinates from the edges before we render them.
      const rawNodes: Node<GraphNodeData>[] = data.nodes.map((node: Node<GraphNodeData>) => ({
        ...node,
        type: 'graphNode',
      }));
      const layouted = getLayoutedElements(rawNodes, data.edges);
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
    <div className="w-screen h-screen bg-slate-50 flex flex-col" style={{ width: '100vw', height: '100vh' }}>
      
      {/* Navbar with Search Form */}
      <header className="h-16 w-full px-4 bg-white shadow-sm flex justify-between items-center border-b border-slate-200 shrink-0">
        <h1 className="text-xl font-bold text-slate-800">Repo Analyzer MVP</h1>

        <form onSubmit={handleAnalyze} className="flex gap-2 w-1/3 min-w-[300px]">
          <input
            type="url"
            placeholder="https://github.com/user/repo"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            className="flex-1 px-3 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:border-blue-500"
            required
          />
          <button
            type="submit"
            disabled={isLoading}
            className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:bg-blue-300 transition-colors"
          >
            {isLoading ? 'Analyzing...' : 'Analyze'}
          </button>
        </form>
      </header>

      {/* Inline error banner for /analyze failures - repo too big, not found, etc. */}
      {analyzeError && (
        <div className="px-4 py-2.5 bg-red-50 border-b border-red-200 text-red-700 text-sm flex justify-between items-center shrink-0">
          <span>{analyzeError}</span>
          <button
            onClick={() => setAnalyzeError(null)}
            className="text-red-400 hover:text-red-600 cursor-pointer focus:outline-none ml-4"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 w-full flex overflow-hidden relative">
        
        {/* React Flow Canvas */}
        <div className={`${selectedNode ? 'w-2/3' : 'w-full'} h-full transition-all duration-300 ease-in-out`}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick} // Attaching the Phase 2 click listener
            fitView
          >
            <Background color="#ccc" gap={16} />
            <Controls />
          </ReactFlow>
        </div>

        {/* Phase 2: Interactive Code Inspector Sidebar */}
        {selectedNode && (
          <div className="w-1/3 h-full bg-[#1e1e1e] text-[#d4d4d4] flex flex-col border-l border-slate-300 shadow-2xl z-10 shrink-0">
            {/* Sidebar Header */}
            <div className="p-4 border-b border-[#333] flex justify-between items-center bg-[#252526]">
              <h3 className="text-sm font-bold text-white m-0 truncate pr-4">
                {String(selectedNode.data.label)}
              </h3>
              <button 
                onClick={() => setSelectedNode(null)} 
                className="text-gray-400 hover:text-white cursor-pointer focus:outline-none"
              >
                ✕
              </button>
            </div>
            
            {/* Sidebar Code Content */}
            <div className="p-4 overflow-y-auto flex-1">
              <pre className="m-0 text-sm font-mono whitespace-pre-wrap break-words">
                <code>
                  {selectedNode.data.code ? String(selectedNode.data.code) : "# No source code available for this node"}
                </code>
              </pre>
            </div>
          </div>
        )}
      </div>

      <ChatPanel jobId={jobId} scope={chatScope} />
    </div>
  );
}