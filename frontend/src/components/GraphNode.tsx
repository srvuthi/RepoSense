import { motion } from 'framer-motion';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';

export type GraphNodeData = {
  label: string;
  type: 'file' | 'external-group';
  language: 'python' | 'javascript' | 'typescript' | null;
  code?: string | null;
  folder?: string;
  dependencies?: string[];
};

export type GraphNodeType = Node<GraphNodeData, 'graphNode'>;

const LANGUAGE_STYLE: Record<
  string,
  { gradient: string; text: string; label: string; ring: string; border: string }
> = {
  python: {
    gradient: 'from-sky-400 to-yellow-300',
    text: 'text-slate-900',
    label: 'Py',
    ring: 'shadow-[0_0_18px_-4px_rgba(56,189,248,0.65)]',
    border: 'border-sky-400/40',
  },
  javascript: {
    gradient: 'from-yellow-300 to-yellow-500',
    text: 'text-slate-900',
    label: 'JS',
    ring: 'shadow-[0_0_18px_-4px_rgba(250,204,21,0.6)]',
    border: 'border-yellow-400/40',
  },
  typescript: {
    gradient: 'from-blue-400 to-blue-600',
    text: 'text-white',
    label: 'TS',
    ring: 'shadow-[0_0_18px_-4px_rgba(96,165,250,0.65)]',
    border: 'border-blue-400/40',
  },
};

const FALLBACK_STYLE = {
  gradient: 'from-slate-400 to-slate-600',
  text: 'text-white',
  label: '•',
  ring: '',
  border: 'border-white/10',
};

export default function GraphNode({ data, selected }: NodeProps<GraphNodeType>) {
  const style = LANGUAGE_STYLE[data.language ?? ''] ?? FALLBACK_STYLE;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ scale: 1.05 }}
      transition={{ duration: 0.18 }}
      className={`glass-panel relative flex min-w-[170px] items-center gap-2.5 rounded-xl border px-3 py-2.5 ${style.border} ${
        selected
          ? 'shadow-[0_0_0_1.5px_var(--color-cyan),0_0_24px_-4px_var(--color-cyan)] border-cyan-300/60'
          : `${style.ring} hover:border-white/25`
      }`}
    >
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-0 !bg-white/30" />
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-[11px] font-bold ${style.gradient} ${style.text}`}
      >
        {style.label}
      </span>
      <span className="truncate text-[13px] font-medium text-[var(--color-ink)]" title={data.label}>
        {data.label}
      </span>
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-0 !bg-white/30" />
    </motion.div>
  );
}
