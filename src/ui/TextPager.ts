/**
 * TextPager turns Phaser's measured wrapped lines into small readable pages.
 * It owns presentation state only; callers retain the original text and all game data.
 */

/** Small surface shared by Phaser Text and test doubles. */
export interface WrappedTextTarget {
  setText(value: string | string[]): unknown;
  getWrappedText(value: string): string[];
}

/** The page numbers shown beside visible previous and next controls. */
export interface TextPageView {
  page: number;
  pageCount: number;
  canMoveBackward: boolean;
  canMoveForward: boolean;
}

/** Measure, clamp, and render one fixed-line text viewport without truncating its source. */
export class TextPager {
  private source = '';
  private lines: string[] = [''];
  private pageIndex = 0;

  /** Create a pager for one text object and a positive count of visible wrapped lines. */
  constructor(private readonly target: WrappedTextTarget, private readonly linesPerPage: number) {
    if (!Number.isSafeInteger(linesPerPage) || linesPerPage < 1) {
      throw new Error(`TextPager: linesPerPage must be a positive integer, received ${linesPerPage}`);
    }
  }

  /** Measure changed content, reset it to page one, render it, and return detached page metadata. */
  update(value: string): TextPageView {
    if (typeof value !== 'string') throw new Error('TextPager: source text must be a string');
    if (value !== this.source) {
      this.source = value;
      this.target.setText(value);
      const measured = this.target.getWrappedText(value);
      this.lines = measured.length > 0 ? [...measured] : [''];
      this.pageIndex = 0;
    }
    return this.render();
  }

  /** Move by whole pages, clamp at both ends, render, and return detached page metadata. */
  move(delta: number): TextPageView {
    if (!Number.isSafeInteger(delta)) throw new Error(`TextPager: page delta must be an integer, received ${delta}`);
    this.pageIndex = Math.max(0, Math.min(this.pageCount() - 1, this.pageIndex + delta));
    return this.render();
  }

  /** Return to page one without changing or remeasuring the source. */
  reset(): TextPageView {
    this.pageIndex = 0;
    return this.render();
  }

  /** Return every measured line for deterministic reachability checks without exposing mutable state. */
  allLines(): string[] {
    return [...this.lines];
  }

  /** Calculate the positive number of pages required for all measured lines. */
  private pageCount(): number {
    return Math.max(1, Math.ceil(this.lines.length / this.linesPerPage));
  }

  /** Draw exactly one bounded page and return its one-based display position. */
  private render(): TextPageView {
    const pageCount = this.pageCount();
    this.pageIndex = Math.max(0, Math.min(pageCount - 1, this.pageIndex));
    const start = this.pageIndex * this.linesPerPage;
    this.target.setText(this.lines.slice(start, start + this.linesPerPage));
    return {
      page: this.pageIndex + 1,
      pageCount,
      canMoveBackward: this.pageIndex > 0,
      canMoveForward: this.pageIndex + 1 < pageCount,
    };
  }
}
