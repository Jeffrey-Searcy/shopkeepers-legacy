/** Unit coverage for readable, lossless paging of wrapped journal text. */
import { expect, test } from '@playwright/test';
import { TextPager, type WrappedTextTarget } from '../src/ui/TextPager';

/** Predictable text target that wraps source text into fixed four-character lines. */
class FixedWrapTarget implements WrappedTextTarget {
  rendered: string[] = [];

  /** Store the page exactly as TextPager sends it to the renderer. */
  setText(value: string | string[]): void {
    this.rendered = Array.isArray(value) ? [...value] : [value];
  }

  /** Split each explicit paragraph into deterministic chunks without losing characters. */
  getWrappedText(value: string): string[] {
    return value.split('\n').flatMap(line => line.match(/.{1,4}/g) ?? ['']);
  }
}

test('TextPager exposes every measured line and clamps both ends', () => {
  const target = new FixedWrapTarget();
  const pager = new TextPager(target, 2);
  expect(pager.update('abcdefghijkl')).toEqual({ page: 1, pageCount: 2, canMoveBackward: false, canMoveForward: true });
  expect(target.rendered).toEqual(['abcd', 'efgh']);
  expect(pager.move(1)).toEqual({ page: 2, pageCount: 2, canMoveBackward: true, canMoveForward: false });
  expect(target.rendered).toEqual(['ijkl']);
  expect(pager.move(99).page).toBe(2);
  expect(pager.move(-99).page).toBe(1);
  expect(pager.allLines()).toEqual(['abcd', 'efgh', 'ijkl']);
});

test('TextPager resets changed content and rejects invalid navigation', () => {
  const target = new FixedWrapTarget();
  const pager = new TextPager(target, 1);
  pager.update('abcdefgh');
  pager.move(1);
  expect(pager.update('changed')).toMatchObject({ page: 1, pageCount: 2 });
  expect(target.rendered).toEqual(['chan']);
  expect(() => pager.move(0.5)).toThrow('page delta must be an integer');
  expect(() => new TextPager(target, 0)).toThrow('linesPerPage must be a positive integer');
});
