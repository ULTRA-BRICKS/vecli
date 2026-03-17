import { describe, expect, it } from 'bun:test';
import type { VectorGraphState } from '../persistence/types';
import { computeReconciliationDiff } from './diff';

const makeState = (overrides?: Partial<VectorGraphState>): VectorGraphState => ({
  canvas: { width: 100, height: 100 },
  nodes: {},
  edges: [],
  muted: [],
  ...overrides,
});

describe('computeReconciliationDiff', () => {
  it('should detect added node', () => {
    const current = makeState({ nodes: { n1: { id: 'n1', type: 'rectangle', params: {} } } });
    const modified = makeState({
      nodes: {
        n1: { id: 'n1', type: 'rectangle', params: {} },
        n2: { id: 'n2', type: 'ellipse', params: {} },
      },
    });
    const diff = computeReconciliationDiff(current, modified);
    expect(diff.added.nodes.length).toBe(1);
    expect(diff.added.nodes[0].id).toBe('n2');
  });

  it('should detect removed node', () => {
    const current = makeState({
      nodes: {
        n1: { id: 'n1', type: 'rectangle', params: {} },
        n2: { id: 'n2', type: 'ellipse', params: {} },
      },
    });
    const modified = makeState({ nodes: { n1: { id: 'n1', type: 'rectangle', params: {} } } });
    const diff = computeReconciliationDiff(current, modified);
    expect(diff.removed.nodeIds).toEqual(['n2']);
  });

  it('should detect param change', () => {
    const current = makeState({ nodes: { n1: { id: 'n1', type: 'rectangle', params: { width: 50 } } } });
    const modified = makeState({ nodes: { n1: { id: 'n1', type: 'rectangle', params: { width: 100 } } } });
    const diff = computeReconciliationDiff(current, modified);
    expect(diff.modified.params.length).toBe(1);
    expect(diff.modified.params[0].changes.width).toEqual({ old: 50, new: 100 });
  });

  it('should detect mute toggle', () => {
    const current = makeState({ muted: [] });
    const modified = makeState({ muted: ['n1'] });
    const diff = computeReconciliationDiff(current, modified);
    expect(diff.modified.muted.added).toEqual(['n1']);
  });

  it('should detect canvas change', () => {
    const current = makeState({ canvas: { width: 100, height: 100 } });
    const modified = makeState({ canvas: { width: 200, height: 200 } });
    const diff = computeReconciliationDiff(current, modified);
    expect(diff.meta.canvasChanged).toBe(true);
  });

  it('should detect added/removed edges', () => {
    const current = makeState({
      edges: [{ id: 'e1', source: 'a', target: 'b', sourcePort: 'path', targetPort: 'path' }],
    });
    const modified = makeState({
      edges: [{ id: 'e2', source: 'b', target: 'c', sourcePort: 'path', targetPort: 'path' }],
    });
    const diff = computeReconciliationDiff(current, modified);
    expect(diff.removed.edgeIds).toEqual(['e1']);
    expect(diff.added.edges.length).toBe(1);
    expect(diff.added.edges[0].id).toBe('e2');
  });

  it('should detect edge reorder', () => {
    const current = makeState({
      edges: [{ id: 'e1', source: 'a', target: 'b', sourcePort: 'path', targetPort: 'path' }],
    });
    const modified = makeState({
      edges: [{ id: 'e1', source: 'a', target: 'c', sourcePort: 'path', targetPort: 'path' }],
    });
    const diff = computeReconciliationDiff(current, modified);
    expect(diff.modified.reordered.length).toBe(1);
    expect(diff.modified.reordered[0].old.target).toBe('b');
    expect(diff.modified.reordered[0].new.target).toBe('c');
  });

  it('should return empty diff for identical states', () => {
    const state = makeState({ nodes: { n1: { id: 'n1', type: 'rectangle', params: {} } } });
    const diff = computeReconciliationDiff(state, state);
    expect(diff.added.nodes.length).toBe(0);
    expect(diff.removed.nodeIds.length).toBe(0);
    expect(diff.modified.params.length).toBe(0);
    expect(diff.meta.canvasChanged).toBe(false);
  });
});
