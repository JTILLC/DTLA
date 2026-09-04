import React, { useEffect, useRef } from 'react';

/**
 * The Message Board's drawing surface.
 *
 * A transparent canvas over the grey board: a drag draws with the live tool
 * and colour (the wide brush, the thin brush, the pencil; red, blue, black),
 * the eraser rubs the ink out, and the drawing is handed back as an image
 * after every stroke so it survives a reload and can be wiped by the trash.
 */
export default function MemoBoard({ spec, tool, colour, image, onChange, rectStyle }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const last = useRef(null);

  // Restore the drawing, once, and whenever it is wiped from outside.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = spec.board.w;
    canvas.height = spec.board.h;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (image) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0);
      img.src = image;
    }
  }, [image, spec.board.w, spec.board.h]);

  const at = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * spec.board.w, ((e.clientY - r.top) / r.height) * spec.board.h];
  };

  const stroke = (from, to) => {
    const ctx = canvasRef.current.getContext('2d');
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = spec.tools[tool].width;
    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = '#000';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = spec.colours[colour];
    }
    ctx.beginPath();
    ctx.moveTo(from[0], from[1]);
    ctx.lineTo(to[0], to[1]);
    ctx.stroke();
  };

  const down = (e) => {
    e.preventDefault();
    canvasRef.current.setPointerCapture?.(e.pointerId);
    drawing.current = true;
    const p = at(e);
    last.current = p;
    stroke(p, [p[0] + 0.01, p[1]]);     // a tap leaves a dot
  };
  const move = (e) => {
    if (!drawing.current) return;
    const p = at(e);
    stroke(last.current, p);
    last.current = p;
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(canvasRef.current.toDataURL('image/png'));
  };

  return (
    <canvas
      ref={canvasRef}
      className="memo-board"
      style={rectStyle(spec.board)}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onPointerLeave={up}
      aria-label={`Message board — drag to draw with the ${tool}${tool === 'eraser' ? '' : ` in ${colour}`}`}
    />
  );
}
