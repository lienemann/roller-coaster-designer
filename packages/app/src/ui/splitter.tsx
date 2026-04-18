// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useRef, useState } from 'react';

export type SplitterDirection = 'vertical' | 'horizontal';

export interface SplitterProps {
  /** 'vertical' = column splitter (drag left/right to resize side panels).
   *  'horizontal' = row splitter (drag up/down to resize stacked panels). */
  readonly direction: SplitterDirection;
  /** Called with the pixel delta on every move. Negative = shrink the panel
   *  on the "before" side, positive = grow it. */
  readonly onDrag: (deltaPx: number) => void;
  /** Optional aria label for screen readers. */
  readonly label?: string;
}

/**
 * Four-pixel drag handle that sits between two flex/grid children.
 * Hidden until hover/active so it doesn't visually clutter the layout.
 * On pointer-down, captures the pointer and emits delta-px via `onDrag`
 * on every move until release.
 */
export function Splitter({ direction, onDrag, label }: SplitterProps): JSX.Element {
  const last = useRef(0);
  const [dragging, setDragging] = useState(false);

  const handlePointerDown = useCallback(
    (ev: React.PointerEvent<HTMLDivElement>): void => {
      ev.preventDefault();
      ev.currentTarget.setPointerCapture(ev.pointerId);
      last.current = direction === 'vertical' ? ev.clientX : ev.clientY;
      setDragging(true);
    },
    [direction],
  );

  const handlePointerMove = useCallback(
    (ev: React.PointerEvent<HTMLDivElement>): void => {
      if (!dragging) return;
      const current = direction === 'vertical' ? ev.clientX : ev.clientY;
      const delta = current - last.current;
      if (delta !== 0) {
        last.current = current;
        onDrag(delta);
      }
    },
    [dragging, direction, onDrag],
  );

  const handlePointerUp = useCallback((ev: React.PointerEvent<HTMLDivElement>): void => {
    try {
      ev.currentTarget.releasePointerCapture(ev.pointerId);
    } catch {
      // Already released (e.g., pointer left the document).
    }
    setDragging(false);
  }, []);

  // Body cursor feedback during drag: resize arrow across the whole
  // window so the user can drag past the handle without losing grip.
  useEffect(() => {
    if (!dragging) return undefined;
    const cursor = direction === 'vertical' ? 'col-resize' : 'row-resize';
    const prev = document.body.style.cursor;
    document.body.style.cursor = cursor;
    return () => {
      document.body.style.cursor = prev;
    };
  }, [dragging, direction]);

  const isVertical = direction === 'vertical';
  return (
    <div
      role="separator"
      aria-orientation={isVertical ? 'vertical' : 'horizontal'}
      aria-label={label}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className={`group relative z-20 shrink-0 select-none bg-transparent ${
        isVertical
          ? 'h-full w-1 cursor-col-resize hover:bg-sky-400/30'
          : 'h-1 w-full cursor-row-resize hover:bg-sky-400/30'
      } ${dragging ? 'bg-sky-400/40' : ''}`}
    />
  );
}
