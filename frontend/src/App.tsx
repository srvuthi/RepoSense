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

// 1. Initial "chumma" mock data so the canvas isn't empty on load
const initialNodes: Node[] = [
  { id: '1', position: { x: 250, y: 20 }, data: { label: 'main.py' } },
  { id: '2', position: { x: 100, y: 120 }, data: { label: 'api.py' } },
  { id: '3', position: { x: 400, y: 120 }, data: { label: 'database.py' } },
  { id: '4', position: { x: 250, y: 220 }, data: { label: 'models.py' } },
  { id: '5', position: { x: 250, y: 320 }, data: { label: 'utils.py' } },
];

const initialEdges: Edge[] = [
  { id: 'e1-2', source: '1', target: '2' },
  { id: 'e1-3', source: '1', target: '3' },
  { id: 'e2-4', source: '2', target: '4' },
  { id: 'e3-4', source: '3', target: '4' },
  { id: 'e4-5', source: '4', target: '5' },
];
// Initialize the layout engine
const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

// The function that calculates perfect coordinates
const getLayoutedElements = (nodes: Node[], edges: Edge[], direction = 'TB') => {
  dagreGraph.setGraph({ rankdir: direction }); // 'TB' = Top to Bottom

  // Feed the nodes to Dagre with estimated width/height
  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: 175, height: 50 });
  });

  // Feed the connections to Dagre
  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  // Run the math!
  dagre.layout(dagreGraph);

  // Apply the new calculated X/Y coordinates back to React Flow's nodes
  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - 175 / 2,
        y: nodeWithPosition.y - 50 / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
};
export default function App() {
  // State for React Flow nodes and edges
  const [nodes, setNodes] = useState<Node[]>(initialNodes);
  const [edges, setEdges] = useState<Edge[]>(initialEdges);

  // State for the search bar and loading status
  const [repoUrl, setRepoUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Handlers for React Flow interactivity (dragging, connecting)
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
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

  // Function to send the URL to your FastAPI backend
  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrl) return;

    setIsLoading(true);
    try {
      // Pointing to your local FastAPI server
      const response = await fetch('http://localhost:8000/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: repoUrl }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      // --- NEW: Run the backend data through the layout engine ---
      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
        data.nodes,
        data.edges
      );

      // Overwrite the graph with perfectly positioned data
      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
    } catch (error) {
      console.error('Failed to analyze repository:', error);
      alert('Failed to analyze the repository. Check the console for details.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    // Full screen container with inline styles ensuring height/width
    <div className="w-screen h-screen bg-slate-50" style={{ width: '100vw', height: '100vh' }}>
      
      {/* Navbar with Search Form */}
      <header className="absolute top-0 left-0 w-full p-4 bg-white shadow-sm z-10 flex justify-between items-center border-b border-slate-200">
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

      {/* React Flow Canvas */}
      <div className="w-full h-full pt-16" style={{ width: '100%', height: '100%' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          fitView
        >
          <Background color="#ccc" gap={16} />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}