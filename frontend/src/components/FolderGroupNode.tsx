import type { NodeProps, Node } from '@xyflow/react';

export type FolderGroupNodeType = Node<{ label: string }, 'folderGroup'>;

export default function FolderGroupNode({ data }: NodeProps<FolderGroupNodeType>) {
  return (
    <div className="pointer-events-none h-full w-full rounded-2xl border border-white/[0.06] bg-white/[0.015]">
      <div className="px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-[var(--color-muted)]">
        {data.label}
      </div>
    </div>
  );
}
