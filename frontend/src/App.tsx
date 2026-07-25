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
  dagreGraph.setGraph({ rankdir: direction });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: 175, height: 50 });
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
        x: nodeWithPosition.x - 175 / 2,
        y: nodeWithPosition.y - 50 / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
};

export default function App() {
  const [nodes, setNodes] = useState<Node[]>(initialNodes);
  const [edges, setEdges] = useState<Edge[]>(initialEdges);

  const [repoUrl, setRepoUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Phase 2: State for the Code Inspector Panel
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

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

  // Phase 2: Handle click event to populate the sidebar
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
  }, []);

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrl) return;

    setIsLoading(true);
    setSelectedNode(null); // Close sidebar on new analysis
    
    try {
      const response = await fetch('http://localhost:8000/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: repoUrl }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      // We skip dagre layout for the backend data here because Phase 3 sets absolute 
      // X/Y coordinates to group the nested file/function architectural boxes.
      setNodes(data.nodes);
      setEdges(data.edges);
    } catch (error) {
      console.error('Failed to analyze repository:', error);
      alert('Failed to analyze the repository. Check the console for details.');
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

      {/* Main Content Area */}
      <div className="flex-1 w-full flex overflow-hidden relative">
        
        {/* React Flow Canvas */}
        <div className={`${selectedNode ? 'w-2/3' : 'w-full'} h-full transition-all duration-300 ease-in-out`}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
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
    </div>
  );
}