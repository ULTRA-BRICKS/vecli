/**
 * @file Persistence tests — serialization, operation log, snapshot, auto-save
 *
 * Accessed via: Internal module, not exposed
 */

import { describe, expect, it } from 'bun:test';
import { HistoryManager } from '../graph/history';
import { VectorGraphModel } from '../graph/vector-graph';
import type { GraphNode } from '../types';
import { OperationLog } from './operation-log';
import { deserializeGraph, serializeGraph } from './serialize';
import type { VectorGraphState } from './types';

/** Retrieve a node that must exist — throws if not found (test setup error). */
function mustGetNode(graph: VectorGraphModel, id: string): GraphNode {
  const node = graph.getNode(id);
  if (!node) throw new Error(`Node ${id} not found`);
  return node;
}

describe('VectorGraphFile serialization', () => {
  it('should serialize and deserialize a graph', () => {
    const model = VectorGraphModel.create('test', 'Test', 100, 100);
    model.addNode({ type: 'rectangle', params: { width: 50, height: 50 } });
    const file = serializeGraph(model, { componentPath: 'src/App.tsx' });
    expect(file.version).toBe(1);
    expect(file.meta.componentPath).toBe('src/App.tsx');
    expect(Object.keys(file.base.nodes).length).toBe(1);

    const { model: loaded, meta } = deserializeGraph(file);
    expect(loaded.nodeCount).toBe(1);
    expect(meta.componentPath).toBe('src/App.tsx');
  });

  it('should preserve operation log from history', () => {
    const model = VectorGraphModel.create('test', 'Test', 100, 100);
    const history = new HistoryManager();
    const nodeId = model.addNode({ type: 'rectangle', params: { width: 50, height: 50 } });

    history.begin('Add rectangle');
    history.recordAddNode(mustGetNode(model, nodeId));
    history.commit();

    const file = serializeGraph(model, { componentPath: '' }, history);
    expect(file.operations.length).toBe(1);
    expect(file.operations[0].description).toBe('Add rectangle');
  });

  it('should roundtrip through JSON', () => {
    const model = VectorGraphModel.create('test', 'RT', 200, 200);
    model.addNode({ type: 'ellipse', params: { rx: 50, ry: 50 } });
    const file = serializeGraph(model, { componentPath: 'test.tsx' });
    const json = JSON.stringify(file);
    const parsed = JSON.parse(json);
    const { model: loaded } = deserializeGraph(parsed);
    expect(loaded.nodeCount).toBe(1);
  });

  it('should handle empty graph', () => {
    const model = VectorGraphModel.create('empty', 'Empty', 100, 100);
    const file = serializeGraph(model, { componentPath: '' });
    expect(file.operations.length).toBe(0);
    const { model: loaded } = deserializeGraph(file);
    expect(loaded.nodeCount).toBe(0);
  });

  it('should preserve undoPointer from history', () => {
    const model = VectorGraphModel.create('test', 'Test', 100, 100);
    const history = new HistoryManager();
    const nodeId = model.addNode({ type: 'rectangle', params: { width: 50 } });

    history.begin('Add rect');
    history.recordAddNode(mustGetNode(model, nodeId));
    history.commit();

    history.begin('Change width');
    history.recordParamChange(nodeId, 'width', 50, 100);
    model.setParam(nodeId, 'width', 100);
    history.commit();

    const file = serializeGraph(model, { componentPath: '' }, history);
    expect(file.undoPointer).toBe(2);
    expect(file.operations.length).toBe(2);
  });

  it('should preserve viewport settings', () => {
    const model = VectorGraphModel.create('test', 'Test', 100, 100);
    const file = serializeGraph(model, { componentPath: '' });
    expect(file.viewport).toEqual({ zoom: 1, panX: 0, panY: 0 });

    const { model: loaded } = deserializeGraph(file);
    const json = loaded.toJSON();
    expect(json.viewport).toEqual({ zoom: 1, panX: 0, panY: 0 });
  });
});

function emptyBase(): VectorGraphState {
  return { canvas: { width: 100, height: 100 }, nodes: {}, edges: [], muted: [] };
}

describe('OperationLog', () => {
  it('should append operations', () => {
    const log = new OperationLog();
    log.append({ timestamp: 1, description: 'test', diffs: [] });
    expect(log.length).toBe(1);
  });

  it('should compact old operations', () => {
    const log = new OperationLog();
    for (let i = 0; i < 150; i++) {
      log.append({ timestamp: i, description: `op-${i}`, diffs: [] });
    }
    const { operations } = log.compact(emptyBase(), 100);
    expect(operations.length).toBe(100);
    expect(log.length).toBe(100);
  });

  it('should apply addNode during compaction', () => {
    const log = new OperationLog();
    log.append({
      timestamp: 1,
      description: 'add rect',
      diffs: [{ kind: 'addNode', node: { id: 'n1', type: 'rectangle', params: { width: 50 } } }],
    });
    log.append({
      timestamp: 2,
      description: 'filler',
      diffs: [],
    });
    const { newBase } = log.compact(emptyBase(), 1);
    expect(newBase.nodes.n1).toBeDefined();
    expect(newBase.nodes.n1.type).toBe('rectangle');
  });

  it('should apply paramChange during compaction', () => {
    const log = new OperationLog();
    log.append({
      timestamp: 1,
      description: 'add rect',
      diffs: [{ kind: 'addNode', node: { id: 'n1', type: 'rectangle', params: { width: 50 } } }],
    });
    log.append({
      timestamp: 2,
      description: 'change width',
      diffs: [{ kind: 'paramChange', nodeId: 'n1', param: 'width', oldValue: 50, newValue: 100 }],
    });
    log.append({
      timestamp: 3,
      description: 'filler',
      diffs: [],
    });
    const { newBase } = log.compact(emptyBase(), 1);
    expect(newBase.nodes.n1.params.width).toBe(100);
  });

  it('should apply removeNode during compaction', () => {
    const base = emptyBase();
    base.nodes.n1 = { id: 'n1', type: 'rectangle', params: {} };
    const log = new OperationLog();
    log.append({
      timestamp: 1,
      description: 'remove rect',
      diffs: [{ kind: 'removeNode', node: { id: 'n1', type: 'rectangle', params: {} }, removedEdges: [] }],
    });
    log.append({ timestamp: 2, description: 'filler', diffs: [] });
    const { newBase } = log.compact(base, 1);
    expect(newBase.nodes.n1).toBeUndefined();
  });

  it('should apply muteNode during compaction', () => {
    const base = emptyBase();
    base.nodes.n1 = { id: 'n1', type: 'rectangle', params: {} };
    const log = new OperationLog();
    log.append({
      timestamp: 1,
      description: 'mute',
      diffs: [{ kind: 'muteNode', nodeId: 'n1', muted: true }],
    });
    log.append({ timestamp: 2, description: 'filler', diffs: [] });
    const { newBase } = log.compact(base, 1);
    expect(newBase.muted).toContain('n1');
  });

  it('should apply moveNode during compaction', () => {
    const base = emptyBase();
    base.nodes.n1 = { id: 'n1', type: 'rectangle', params: {}, position: { x: 0, y: 0 } };
    const log = new OperationLog();
    log.append({
      timestamp: 1,
      description: 'move',
      diffs: [{ kind: 'moveNode', nodeId: 'n1', oldPosition: { x: 0, y: 0 }, newPosition: { x: 10, y: 20 } }],
    });
    log.append({ timestamp: 2, description: 'filler', diffs: [] });
    const { newBase } = log.compact(base, 1);
    expect(newBase.nodes.n1.position).toEqual({ x: 10, y: 20 });
  });

  it('should not compact when under keepCount', () => {
    const log = new OperationLog();
    log.append({ timestamp: 1, description: 'test', diffs: [] });
    const { operations } = log.compact(emptyBase(), 100);
    expect(operations.length).toBe(1);
  });

  it('should expose operations as readonly', () => {
    const log = new OperationLog();
    log.append({ timestamp: 1, description: 'a', diffs: [] });
    log.append({ timestamp: 2, description: 'b', diffs: [] });
    expect(log.operations.length).toBe(2);
    expect(log.operations[0].description).toBe('a');
  });
});
