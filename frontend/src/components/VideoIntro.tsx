import { useEffect, useRef, useState } from "react";
import { WELCOME } from "../lib/welcomeStrokes";
import "./video-intro.css";

/**
 * Opening: a filmed (Veo, cleaned and graded) candlelit desk where the journal opens and the camera dives
 * into the blank page; on the parchment the video ends on, "Welcome" is written with a broad nib, then the
 * whole overlay fades into the app. Once per browser session; Esc / Enter / Skip close it.
 * The older GSAP version (JournalIntro) is kept in the repo as a fallback.
 */

const SEEN_KEY = "clearscript-intro-seen";
const WRITE_MS = 2300;   // whole word
const HOLD_MS = 650;     // let it sit before fading
const FADE_MS = 900;

type P = [number, number];
/** Catmull-Rom through the baked points so the long swash segments read as curves. */
function smooth(pts: P[], step = 6): P[] {
  const out: P[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const n = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let k = 1; k <= n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  return out;
}
const STROKES: P[][] = WELCOME.strokes.map((a) => {
  const pts: P[] = [];
  for (let i = 0; i < a.length; i += 2) pts.push([a[i], a[i + 1]]);
  return smooth(pts);
});
const pathD = (pts: P[]) => "M" + pts.map((p) => p[0].toFixed(1) + " " + p[1].toFixed(1)).join("L");
// Broad nib held at 45°: the ribbon swept by the nib edge, thick on down-strokes and hairline across.
const NIB_W = 52;
const NIB: P = [(NIB_W / 2) * Math.SQRT1_2, -(NIB_W / 2) * Math.SQRT1_2];
const RIBBONS = STROKES.map((pts) => {
  const a = pts.map(([x, y]) => [x - NIB[0], y - NIB[1]] as P);
  const b = pts.map(([x, y]) => [x + NIB[0], y + NIB[1]] as P).reverse();
  return pathD([...a, ...b]) + "Z";
});
const CENTRES = STROKES.map(pathD);
const GAP = 650; // pen lift between strokes, as an equivalent length

export function VideoIntro() {
  const [open, setOpen] = useState(() => {
    try {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
      return sessionStorage.getItem(SEEN_KEY) !== "1";
    } catch { return true; }
  });
  const [phase, setPhase] = useState<"film" | "write" | "out">("film");
  const root = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const timers = useRef<number[]>([]);

  const close = () => {
    try { sessionStorage.setItem(SEEN_KEY, "1"); } catch { /* storage blocked: intro shows again next load */ }
    setPhase("out");
    timers.current.push(window.setTimeout(() => setOpen(false), FADE_MS));
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "Enter") close(); };
    window.addEventListener("keydown", onKey);
    const v = video.current;
    v?.play().catch(() => close()); // autoplay refused or file missing: go straight to the app
    const all = timers.current;
    return () => { window.removeEventListener("keydown", onKey); all.forEach(clearTimeout); };
  }, [open]);

  // Write "Welcome" once the film has landed on the parchment.
  useEffect(() => {
    if (phase !== "write" || !svg.current) return;
    const reveals = Array.from(svg.current.querySelectorAll<SVGPathElement>(".vi-reveal"));
    const lens = reveals.map((p) => p.getTotalLength());
    const total = lens.reduce((s, l) => s + l, 0) + GAP * (lens.length - 1);
    let at = 0;
    reveals.forEach((p, i) => {
      const len = lens[i];
      p.style.strokeDasharray = `${len} ${len}`;
      p.style.strokeDashoffset = `${len}`;
      p.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], {
        duration: (len / total) * WRITE_MS, delay: (at / total) * WRITE_MS, easing: "cubic-bezier(.45,.05,.55,.95)", fill: "forwards",
      });
      at += len + GAP;
    });
    timers.current.push(window.setTimeout(close, WRITE_MS + HOLD_MS));
  }, [phase]);

  if (!open) return null;
  return (
    <div ref={root} className={`vi-root ${phase === "out" ? "is-out" : ""}`} style={{ ["--vi-fade" as string]: `${FADE_MS}ms` }}
      role="dialog" aria-label="ClearScript intro: a journal opens on a candlelit desk and Welcome is written on its page">
      <video ref={video} className="vi-film" muted playsInline preload="auto"
        onEnded={() => setPhase((p) => (p === "film" ? "write" : p))}>
        <source src="/intro/intro.webm" type="video/webm" />
        <source src="/intro/intro.mp4" type="video/mp4" onError={close} />
      </video>
      <svg ref={svg} className={`vi-ink ${phase !== "film" ? "is-on" : ""}`} viewBox={`0 0 ${WELCOME.w} ${WELCOME.h}`} aria-hidden="true">
        <defs>
          {CENTRES.map((d, i) => (
            <mask key={i} id={`vi-m${i}`} maskUnits="userSpaceOnUse" x="-100" y="-100" width={WELCOME.w + 200} height={WELCOME.h + 200}>
              <path className="vi-reveal" d={d} />
            </mask>
          ))}
        </defs>
        <g className="vi-ink-fill">
          {RIBBONS.map((d, i) => <path key={i} d={d} mask={`url(#vi-m${i})`} />)}
        </g>
      </svg>
      <span className={`vi-title ${phase !== "film" ? "is-on" : ""}`}>ClearScript</span>
      <button className="vi-skip" onClick={close}>Skip intro <kbd>Esc</kbd></button>
    </div>
  );
}
