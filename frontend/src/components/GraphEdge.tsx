import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps, type Edge } from '@xyflow/react';

export type GraphEdgeData = {
  kind: 'imports' | 'imports-external';
  calls?: string[];
  packages?: string[];
};

export type GraphEdgeType = Edge<GraphEdgeData, 'graphEdge'>;

export default function GraphEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<GraphEdgeType>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const isExternal = data?.kind === 'imports-external';
  const calls = data?.calls ?? [];

  return (
    <>
      <BaseEdge
        path={edgePath}
        style={{
          stroke: isExternal ? 'rgba(167,139,250,0.35)' : 'url(#graph-edge-gradient)',
          strokeWidth: selected ? 2.5 : isExternal ? 1.25 : 1.75,
          strokeDasharray: isExternal ? '4 5' : '5 5',
          filter: isExternal
            ? undefined
            : `drop-shadow(0 0 ${selected ? 4 : 2}px rgba(34,211,238,0.55))`,
          animation: 'edge-flow 1.4s linear infinite',
        }}
      />
      {calls.length > 0 && (
        <EdgeLabelRenderer>
          <div
            title={`Calls: ${calls.join(', ')}`}
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="glass-panel rounded-full border-cyan-300/30 px-1.5 py-0.5 text-[9px] font-medium text-cyan-200 shadow-[0_0_8px_-2px_rgba(34,211,238,0.6)]"
          >
            {calls.length} call{calls.length === 1 ? '' : 's'}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
