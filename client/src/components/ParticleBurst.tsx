import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface Props {
  active: boolean;
  origin?: { x: number; y: number };
  duration?: number; // ms
}

const COLORS = ["#7c5cff", "#4fd0c4", "#4ade80", "#f59e0b", "#fb7185", "#60a5fa"];

export function ParticleBurst({ active, origin, duration = 2400 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const startedRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = window.innerWidth * window.devicePixelRatio;
    canvas.height = window.innerHeight * window.devicePixelRatio;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    const ox = origin?.x ?? window.innerWidth / 2;
    const oy = origin?.y ?? window.innerHeight / 2;
    const count = 220;
    const ps: Particle[] = [];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 200 + Math.random() * 600;
      ps.push({
        x: ox,
        y: oy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: 900 + Math.random() * 1400,
        color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
        size: 3 + Math.random() * 5,
      });
    }
    particlesRef.current = ps;
    startedRef.current = performance.now();

    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(40, now - last) / 1000;
      last = now;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      const elapsed = now - startedRef.current;
      let alive = 0;
      for (const p of particlesRef.current) {
        p.life += dt * 1000;
        if (p.life > p.maxLife) continue;
        alive++;
        p.vy += 900 * dt; // gravity
        p.vx *= 1 - 0.6 * dt; // drag
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const a = Math.max(0, 1 - p.life / p.maxLife);
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (alive > 0 && elapsed < duration + 1200) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    };
  }, [active, origin?.x, origin?.y, duration]);

  if (!active) return null;
  return <canvas ref={canvasRef} className="particles" />;
}
