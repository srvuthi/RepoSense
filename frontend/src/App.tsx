import { useCallback } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// 1. Define 5-6 fake nodes
const initialNodes = [
  { id: '1', position: { x: 250, y: 20 }, data: { label: 'main.py' } },
  { id: '2', position: { x: 100, y: 120 }, data: { label: 'api.py' } },
  { id: '3', position: { x: 400, y: 120 }, data: { label: 'database.py' } },
  { id: '4', position: { x: 100, y: 220 }, data: { label: 'utils.py' } },
  { id: '5', position: { x: 400, y: 220 }, data: { label: 'models.py' } },
];

// 2. Define the edges (who imports whom)
const initialEdges = [
  { id: 'e1-2', source: '1', target: '2', animated: true },
  { id: 'e1-3', source: '1', target: '3', animated: true },
  { id: 'e2-4', source: '2', target: '4' },
  { id: 'e3-5', source: '3', target: '5' },
];

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    (params: Connection | Edge) => setEdges((eds) => addEdge(params, eds)),
    [setEdges],
  );

  return (
    // Added explicit inline styles here:
    <div className="w-screen h-screen bg-slate-50" style={{ width: '100vw', height: '100vh' }}>
      {/* Navbar placeholder */}
      <header className="absolute top-0 left-0 w-full p-4 bg-white shadow-sm z-10 flex justify-between items-center">
        <h1 className="text-xl font-bold text-slate-800">Repo Analyzer MVP</h1>
        <div className="text-sm text-slate-500">Mock Graph Active</div>
      </header>

      {/* React Flow Canvas */}
      {/* Added explicit inline styles here too: */}
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