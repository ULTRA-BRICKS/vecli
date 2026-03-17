/**
 * @file Tests for semantic diff and reverse sync pipeline
 *
 * Accessed via: Internal module — test suite for sync/ modules
 */

import { describe, expect, it } from 'bun:test';
import { PathBuilder } from '../path/builder';
import type { SceneItem } from '../types';
import { IDENTITY_TRANSFORM } from '../types';
import { computeSemanticDiff } from './semantic-diff';

const makeItem = (id: string, path: ReturnType<PathBuilder['build']>, fill?: string): SceneItem => ({
  id,
  path,
  style: fill ? { fill: { type: 'solid', color: fill } } : {},
  transform: IDENTITY_TRANSFORM,
  visible: true,
});

describe('computeSemanticDiff', () => {
  it('should detect no changes when paths match', () => {
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const diff = computeSemanticDiff([makeItem('n1', rect, '#ff0000')], [makeItem('x', rect, '#ff0000')]);
    expect(diff.matched.length).toBe(1);
    expect(diff.matched[0].styleChanged).toBe(false);
    expect(diff.added.length).toBe(0);
    expect(diff.removed.length).toBe(0);
  });

  it('should detect added shape', () => {
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const circle = new PathBuilder().moveTo(50, 0).arcTo(50, 50, 0, 1, 1, 50, 100).close().build();
    const diff = computeSemanticDiff([makeItem('n1', rect)], [makeItem('x1', rect), makeItem('x2', circle)]);
    expect(diff.added.length).toBe(1);
  });

  it('should detect removed shape', () => {
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const tri = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(50, 86.6).close().build();
    const diff = computeSemanticDiff([makeItem('n1', rect), makeItem('n2', tri)], [makeItem('x1', rect)]);
    expect(diff.removed.length).toBe(1);
    expect(diff.removed[0].id).toBe('n2');
  });

  it('should detect style change on matched shape', () => {
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const diff = computeSemanticDiff([makeItem('n1', rect, '#ff0000')], [makeItem('x', rect, '#00ff00')]);
    expect(diff.matched.length).toBe(1);
    expect(diff.matched[0].styleChanged).toBe(true);
    expect(diff.matched[0].geometryChanged).toBe(false);
  });

  it('should handle empty scenes', () => {
    const diff = computeSemanticDiff([], []);
    expect(diff.matched.length).toBe(0);
    expect(diff.added.length).toBe(0);
    expect(diff.removed.length).toBe(0);
    expect(diff.ambiguous).toBe(false);
  });

  it('should set ambiguous when most shapes unmatched', () => {
    const r1 = new PathBuilder().moveTo(0, 0).lineTo(10, 0).close().build();
    const r2 = new PathBuilder().moveTo(0, 0).lineTo(20, 0).close().build();
    const r3 = new PathBuilder().moveTo(0, 0).lineTo(30, 0).close().build();
    const r4 = new PathBuilder().moveTo(0, 0).lineTo(40, 0).close().build();
    const diff = computeSemanticDiff(
      [makeItem('n1', r1), makeItem('n2', r2)],
      [makeItem('x1', r3), makeItem('x2', r4)],
    );
    // All shapes different, no bounding box overlap → ambiguous
    expect(diff.ambiguous).toBe(true);
  });

  it('should match multiple shapes correctly', () => {
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const tri = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(50, 86.6).close().build();
    const diff = computeSemanticDiff(
      [makeItem('n1', rect, '#ff0000'), makeItem('n2', tri, '#0000ff')],
      [makeItem('x1', tri, '#0000ff'), makeItem('x2', rect, '#00ff00')],
    );
    expect(diff.matched.length).toBe(2);
    expect(diff.added.length).toBe(0);
    expect(diff.removed.length).toBe(0);

    // rect matched with style change
    const rectMatch = diff.matched.find((m) => m.currentId === 'n1');
    expect(rectMatch).toBeDefined();
    expect(rectMatch!.styleChanged).toBe(true);

    // tri matched without style change
    const triMatch = diff.matched.find((m) => m.currentId === 'n2');
    expect(triMatch).toBeDefined();
    expect(triMatch!.styleChanged).toBe(false);
  });

  it('should not flag ambiguous when all shapes match', () => {
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const diff = computeSemanticDiff([makeItem('n1', rect)], [makeItem('x1', rect)]);
    expect(diff.ambiguous).toBe(false);
  });

  it('should use bounding box fallback for slightly different paths', () => {
    // Two rectangles with very similar geometry but different path data
    const rect1 = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    // Same area but slightly shifted — still >70% overlap
    const rect2 = new PathBuilder().moveTo(5, 5).lineTo(105, 5).lineTo(105, 105).lineTo(5, 105).close().build();
    const diff = computeSemanticDiff([makeItem('n1', rect1)], [makeItem('x1', rect2)]);
    // Overlap: 95x95 = 9025, smaller area = 10000, ratio = 0.9025 > 0.7
    // Area ratio: 10000/10000 = 1 < 2
    expect(diff.matched.length).toBe(1);
    expect(diff.matched[0].geometryChanged).toBe(true);
    expect(diff.added.length).toBe(0);
    expect(diff.removed.length).toBe(0);
  });
});
