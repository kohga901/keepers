import React, { useEffect, useRef, useState } from 'react';
import type { HistorySwipeableProps } from './HistorySwipeable';

export function HistorySwipeable({ children, renderRightActions, onSwipeableOpen }: HistorySwipeableProps) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<{
    id: number; x: number; y: number; width: number;
    axis: 'pending' | 'horizontal' | 'vertical'; offset: number;
  } | null>(null);
  const suppressClick = useRef(false);
  const deleting = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);

  const finish = (event: React.PointerEvent<HTMLDivElement>, canceled: boolean) => {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    gesture.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!canceled && current.axis === 'horizontal' && -current.offset >= current.width / 2) {
      deleting.current = true;
      setOffset(-current.width);
      timer.current = setTimeout(onSwipeableOpen, 180);
    } else {
      setOffset(0);
    }
  };

  return (
    <div
      style={{ position: 'relative', overflow: 'hidden', touchAction: 'pan-y pinch-zoom', userSelect: 'none' }}
      onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0 || deleting.current || gesture.current) return;
        suppressClick.current = false;
        gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY,
          width: event.currentTarget.getBoundingClientRect().width, axis: 'pending', offset: 0 };
      }}
      onPointerMove={event => {
        const current = gesture.current;
        if (!current || current.id !== event.pointerId) return;
        const dx = event.clientX - current.x;
        const dy = event.clientY - current.y;
        if (current.axis === 'pending' && Math.max(Math.abs(dx), Math.abs(dy)) >= 10) {
          current.axis = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
          suppressClick.current = true;
          if (current.axis === 'horizontal') {
            event.currentTarget.setPointerCapture(event.pointerId);
            setDragging(true);
          }
        }
        if (current.axis !== 'horizontal') return;
        event.preventDefault();
        current.offset = Math.max(-current.width, Math.min(0, dx));
        setOffset(current.offset);
      }}
      onPointerUp={event => finish(event, false)}
      onPointerCancel={event => finish(event, true)}
      onLostPointerCapture={event => finish(event, true)}
      onPointerLeave={event => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) finish(event, true);
      }}
      onDragStart={event => event.preventDefault()}
      onClickCapture={event => {
        if (suppressClick.current || deleting.current) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none',
        visibility: offset < 0 ? 'visible' : 'hidden' }}>
        {renderRightActions()}
      </div>
      <div style={{ position: 'relative', transform: `translateX(${offset}px)`,
        transition: dragging ? 'none' : 'transform 180ms ease-out' }}>
        {children}
      </div>
    </div>
  );
}
