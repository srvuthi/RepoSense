import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';

export type GraphNodeData = {
  label: string;
  type: 'file' | 'external';
  language: 'python' | 'javascript' | 'typescript' | null;
  code?: string | null;
};

export type GraphNodeType = Node<GraphNodeData, 'graphNode'>;

const LANGUAGE_STYLE: Record<string, { badge: string; badgeText: string; border: string; bg: string }> = {
  python: { badge: 'bg-blue-600', badgeText: 'PY', border: 'border-blue-400', bg: 'bg-blue-50' },
  javascript: { badge: 'bg-yellow-400 text-slate-900', badgeText: 'JS', border: 'border-yellow-400', bg: 'bg-yellow-50' },
  typescript: { badge: 'bg-sky-600', badgeText: 'TS', border: 'border-sky-500', bg: 'bg-sky-50' },
};

const EXTERNAL_STYLE = {
  badge: 'bg-slate-400',
  badgeText: 'EXT',
  border: 'border-slate-300 border-dashed',
  bg: 'bg-slate-50',
};

export default function GraphNode({ data }: NodeProps<GraphNodeType>) {
  const isExternal = data.type === 'external';
  const style = isExternal ? EXTERNAL_STYLE : LANGUAGE_STYLE[data.language ?? ''] ?? EXTERNAL_STYLE;

  return (
    <div
      className={`px-3 py-2 rounded-md border-2 shadow-sm min-w-[160px] flex items-center gap-2 ${style.border} ${style.bg}`}
    >
      <Handle type="target" position={Position.Top} className="!bg-slate-400" />
      <span
        className={`shrink-0 flex items-center justify-center w-8 h-6 rounded text-[10px] font-bold text-white ${style.badge}`}
      >
        {style.badgeText}
      </span>
      <span
        className={`text-sm font-medium truncate ${isExternal ? 'italic text-slate-500' : 'text-slate-800'}`}
        title={data.label}
      >
        {data.label}
      </span>
      <Handle type="source" position={Position.Bottom} className="!bg-slate-400" />
    </div>
  );
}
