import { useEffect, useRef } from 'react';
import midnightSymbolUrl from './assets/midnight-symbol.png';

/**
 * Slow horizontal sine lasers in the Midnight blue ramp, drifting behind the page.
 * Pointer proximity raises amplitude and brightness locally, and drags the phase.
 * Ambient only — content always sits above it at a higher z-index.
 */
export function WaveField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d', { alpha: true });
    if (!ctx) return;

    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

    const LINES = [
      { y: 0.12, amp: 38, len: 0.0018, spd: 0.00020, w: 1.6, color: [134, 134, 255], a: 0.17 },
      { y: 0.26, amp: 64, len: 0.0012, spd: -0.00014, w: 1.3, color: [87, 87, 255], a: 0.14 },
      { y: 0.40, amp: 48, len: 0.0023, spd: 0.00027, w: 1.8, color: [0, 0, 254], a: 0.26 },
      { y: 0.55, amp: 82, len: 0.0010, spd: -0.00010, w: 1.4, color: [0, 0, 166], a: 0.32 },
      { y: 0.68, amp: 42, len: 0.0019, spd: 0.00017, w: 1.5, color: [87, 87, 255], a: 0.12 },
      { y: 0.82, amp: 68, len: 0.0014, spd: -0.00023, w: 1.7, color: [0, 0, 254], a: 0.20 },
      { y: 0.94, amp: 32, len: 0.0027, spd: 0.00013, w: 1.3, color: [134, 134, 255], a: 0.10 },
    ];

    const sym = new Image();
    sym.src = midnightSymbolUrl;
    let symReady = false;
    sym.onload = () => { symReady = true; };

    const MARKS = [
      { x: 0.90, y: 0.24, size: 84, a: 0.016, bob: 12, spd: 0.00017, ph: 1.7 },
      { x: 0.72, y: 0.66, size: 148, a: 0.012, bob: 20, spd: 0.00009, ph: 3.1 },
      { x: 0.14, y: 0.86, size: 96, a: 0.015, bob: 14, spd: 0.00013, ph: 4.4 },
    ];

    const REACH = 300;
    let w = 0, h = 0, dpr = 1;
    const ptr = { x: -9999, y: -9999, tx: -9999, ty: -9999, on: 0, ton: 0 };

    function resize() {
      dpr = Math.min(devicePixelRatio || 1, 2);
      w = innerWidth; h = innerHeight;
      cvs!.width = Math.round(w * dpr);
      cvs!.height = Math.round(h * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    addEventListener('resize', resize, { passive: true });

    const onPointerMove = (e: PointerEvent) => { ptr.tx = e.clientX; ptr.ty = e.clientY; ptr.ton = 1; };
    const onPointerLeave = () => { ptr.ton = 0; };
    addEventListener('pointermove', onPointerMove, { passive: true });
    addEventListener('pointerleave', onPointerLeave, { passive: true });

    function drawMarks(t: number) {
      if (!symReady) return;
      for (const M of MARKS) {
        const cx = M.x * w;
        const cy = M.y * h + Math.sin(t * M.spd + M.ph) * M.bob;
        const near = Math.max(0, 1 - Math.hypot(cx - ptr.x, cy - ptr.y) / (REACH * 1.4)) * ptr.on;
        const size = M.size * (1 + near * 0.10);
        ctx!.globalAlpha = Math.min(0.09, M.a * (1 + near * 3.2));
        ctx!.drawImage(sym, cx - size / 2, cy - size / 2, size, size);
        ctx!.globalAlpha = 1;
      }
    }

    function drawLine(L: typeof LINES[number], t: number) {
      const baseY = L.y * h;
      const step = w < 700 ? 10 : 6;
      const pts: Array<[number, number, number]> = [];

      for (let x = -step; x <= w + step; x += step) {
        const dx = x - ptr.x;
        const dyBase = baseY - ptr.y;
        const near = Math.max(0, 1 - Math.abs(dx) / REACH) * ptr.on;
        const dist = Math.hypot(dx, dyBase);
        const pull = Math.max(0, 1 - dist / REACH) * ptr.on;

        const phase = x * L.len + t * L.spd;
        const amp = L.amp * (1 + near * near * 1.5);
        const y = baseY
          + Math.sin(phase) * amp
          + Math.sin(phase * 2.3 + 1.1) * amp * 0.22
          - pull * pull * 34 * Math.sign(dyBase || 1) * -1;

        pts.push([x, y, pull]);
      }

      for (const pass of [{ mul: 7, alpha: 0.20, blur: 20 }, { mul: 1, alpha: 1, blur: 8 }]) {
        ctx!.beginPath();
        ctx!.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length - 1; i++) {
          const [x0, y0] = pts[i];
          const [x1, y1] = pts[i + 1];
          ctx!.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
        }
        let peak = 0;
        for (const p of pts) if (p[2] > peak) peak = p[2];
        const a = L.a * pass.alpha * (1 + peak * 1.8);
        const [r, g, b] = L.color;
        ctx!.strokeStyle = `rgba(${r},${g},${b},${Math.min(a, 0.9)})`;
        ctx!.lineWidth = L.w * pass.mul;
        ctx!.shadowBlur = pass.blur * (1 + peak);
        ctx!.shadowColor = `rgba(${r},${g},${b},0.55)`;
        ctx!.stroke();
      }
      ctx!.shadowBlur = 0;
    }

    function draw(t: number) {
      ctx!.clearRect(0, 0, w, h);
      ptr.x += (ptr.tx - ptr.x) * 0.08;
      ptr.y += (ptr.ty - ptr.y) * 0.08;
      ptr.on += (ptr.ton - ptr.on) * 0.05;

      for (let i = 0; i < 3; i++) drawLine(LINES[i], t);
      drawMarks(t);
      for (let i = 3; i < LINES.length; i++) drawLine(LINES[i], t);

      if (ptr.on > 0.01) {
        const grd = ctx!.createRadialGradient(ptr.x, ptr.y, 0, ptr.x, ptr.y, REACH * 0.8);
        grd.addColorStop(0, `rgba(87,87,255,${0.06 * ptr.on})`);
        grd.addColorStop(1, 'rgba(87,87,255,0)');
        ctx!.fillStyle = grd;
        ctx!.fillRect(ptr.x - REACH, ptr.y - REACH, REACH * 2, REACH * 2);
      }
    }

    let raf = 0, last = 0;
    function loop(now: number) {
      if (now - last > 33) { draw(now); last = now; }
      raf = requestAnimationFrame(loop);
    }

    const onVisibility = () => {
      if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
      else if (!raf) raf = requestAnimationFrame(loop);
    };

    if (reduce) {
      draw(0);
      sym.addEventListener('load', () => draw(0));
    } else {
      raf = requestAnimationFrame(loop);
      document.addEventListener('visibilitychange', onVisibility);
    }

    return () => {
      cancelAnimationFrame(raf);
      removeEventListener('resize', resize);
      removeEventListener('pointermove', onPointerMove);
      removeEventListener('pointerleave', onPointerLeave);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', zIndex: 0, pointerEvents: 'none' }}
    />
  );
}
