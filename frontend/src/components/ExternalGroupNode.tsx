import { motion } from 'framer-motion';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { GraphNodeData } from './GraphNode';

export type ExternalGroupNodeType = Node<GraphNodeData, 'externalGroup'>;

export default function ExternalGroupNode({ data, selected }: NodeProps<ExternalGroupNodeType>) {
  const count = data.dependencies?.length ?? 0;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ scale: 1.04 }}
      transition={{ duration: 0.18 }}
      className={`glass-panel relative flex min-w-[190px] cursor-pointer items-center gap-2.5 rounded-xl border border-dashed px-3 py-2.5 ${
        selected
          ? 'border-violet-300/70 shadow-[0_0_0_1.5px_var(--color-violet),0_0_22px_-4px_var(--color-violet)]'
          : 'border-white/15 hover:border-violet-300/40'
      }`}
    >
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-0 !bg-white/20" />
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/10 text-violet-200">
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
          <path d="m3.27 6.96 8.73 5.04 8.73-5.04M12 22.08V12" />
        </svg>
      </span>
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium italic text-slate-300" title={data.label}>
          {data.label}
        </div>
        <div className="text-[10px] text-[var(--color-muted)]">{count} package{count === 1 ? '' : 's'}</div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-0 !bg-white/20" />
    </motion.div>
  );
}
