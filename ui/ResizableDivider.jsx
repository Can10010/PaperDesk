import React, {useState, useEffect, useRef} from 'react';

export function useSplitRatio(key, initial) {
  const [ratio, setRatio] = useState(() => {
    try { const saved = Number(localStorage.getItem(key) ?? initial); return Number.isFinite(saved) ? Math.min(85, Math.max(15, saved)) : initial; } catch { return initial; }
  });
  useEffect(() => { try { localStorage.setItem(key, String(ratio)); } catch {} }, [key, ratio]);
  return [ratio, setRatio];
}

export default function ResizableDivider({containerRef, value, onChange, label, initial = 50}) {
  const cleanup = useRef(null);
  useEffect(() => () => cleanup.current?.(), []);
  function start(event) {
    if (event.button !== 0) return;
    event.preventDefault(); cleanup.current?.();
    const divider = event.currentTarget;
    divider.focus(); divider.setPointerCapture(event.pointerId);
    document.body.classList.add('resizing-panels');
    const move = e => {
      if (e.pointerId !== event.pointerId) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect?.width) onChange(Math.min(85, Math.max(15, (e.clientX - rect.left) / rect.width * 100)));
    };
    const stop = () => {
      document.body.classList.remove('resizing-panels');
      divider.removeEventListener('pointermove', move);
      divider.removeEventListener('pointerup', stop);
      divider.removeEventListener('pointercancel', stop);
      divider.removeEventListener('lostpointercapture', stop);
      window.removeEventListener('blur', stop);
      if (divider.hasPointerCapture(event.pointerId)) divider.releasePointerCapture(event.pointerId);
      cleanup.current = null;
    };
    cleanup.current = stop;
    divider.addEventListener('pointermove', move);
    divider.addEventListener('pointerup', stop);
    divider.addEventListener('pointercancel', stop);
    divider.addEventListener('lostpointercapture', stop);
    window.addEventListener('blur', stop);
  }
  return <div className="resize-divider" role="separator" aria-label={label} aria-orientation="vertical" aria-valuemin={15} aria-valuemax={85} aria-valuenow={Math.round(value)} tabIndex={0}
    title="拖动调整宽度；双击恢复默认；方向键微调" onPointerDown={start} onDoubleClick={() => onChange(initial)}
    onKeyDown={e => { const next = {ArrowLeft: value - 2, ArrowRight: value + 2, Home: 15, End: 85}[e.key]; if (next !== undefined) { e.preventDefault(); onChange(Math.min(85, Math.max(15, next))); } }} />;
}
