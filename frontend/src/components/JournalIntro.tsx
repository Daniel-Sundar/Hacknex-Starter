import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { WELCOME } from "../lib/welcomeStrokes";
import "./journal-intro.css";

/**
 * 10-second intro: a closed journal on a candlelit desk -> the cover and two pages flip open ->
 * the quill dips into the inkwell and writes "Welcome" -> that page flips -> the camera zooms
 * into the fresh parchment, which dissolves into the app's own parchment background.
 *
 * Built from the photos in public/intro (desk.jpg has the quill painted out; quill.webp is the
 * cut-out quill). Pages are flat elements warped onto the photo's page quads with CSS matrix3d
 * homographies, so the flips and the ink sit in the photo's perspective.
 */

const SEEN_KEY = "clearscript-intro-seen";
const STAGE_W = 1536, STAGE_H = 1024;          // desk photo size; everything below is in its pixels
const PAGE_W = 500, PAGE_H = 670;              // rectified page textures
type P = [number, number];
type Quad = [P, P, P, P];                       // spine-top, outer-top, outer-bottom, spine-bottom

const RIGHT: Quad = [[668, 332], [1032, 268], [1182, 742], [772, 828]];
const LEFT: Quad = [[668, 332], [268, 375], [315, 888], [772, 828]];
const grow = (q: Quad, k: number): Quad => {
  const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
  return q.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]) as Quad;
};
const COVER_R = grow(RIGHT, 1.06);
const COVER_L = grow(LEFT, 1.06);
COVER_L[0] = COVER_R[0];
COVER_L[3] = COVER_R[3];

const QUILL_BOX: P = [1150, 300];               // sprite's top-left in the desk photo
const QUILL_TIP: P = [238, 602];                // nib tip inside the sprite
const QUILL_REST: P = [QUILL_BOX[0] + QUILL_TIP[0], QUILL_BOX[1] + QUILL_TIP[1]];
const INKWELL: P = [1427, 514];

// camera: world point (cx, cy) at the stage centre, scaled by s
const CAM_TIGHT = { s: 1.55, x: 925, y: 548 };
const CAM_FULL = { s: 1, x: 768, y: 512 };
const CAM_ZOOM = { s: 8.5, x: 932, y: 548 };

/** CSS cubic-bezier(0.25, 1, 0.5, 1) as a GSAP ease. */
function cubicBezier(p1x: number, p1y: number, p2x: number, p2y: number) {
  const cx = 3 * p1x, bx = 3 * (p2x - p1x) - cx, ax = 1 - cx - bx;
  const cy = 3 * p1y, by = 3 * (p2y - p1y) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dsx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x, d = dsx(t);
      if (Math.abs(e) < 1e-6 || Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    if (t < 0 || t > 1) {
      let lo = 0, hi = 1;
      t = x;
      while (hi - lo > 1e-6) { if (sx(t) < x) lo = t; else hi = t; t = (lo + hi) / 2; }
    }
    return sy(t);
  };
}
const EASE = cubicBezier(0.25, 1, 0.5, 1);

// rect (0,0)-(w,h) -> quad (TL, TR, BR, BL); returns [A,B,C,D,E,F,G,H]: X=(Ax+By+C)/(Gx+Hy+1)
type Hm = number[];
function homography(w: number, h: number, [p0, p1, p2, p3]: [P, P, P, P]): Hm {
  const dx1 = p1[0] - p2[0], dx2 = p3[0] - p2[0], dx3 = p0[0] - p1[0] + p2[0] - p3[0];
  const dy1 = p1[1] - p2[1], dy2 = p3[1] - p2[1], dy3 = p0[1] - p1[1] + p2[1] - p3[1];
  const den = dx1 * dy2 - dx2 * dy1 || 1e-9;
  const g = (dx3 * dy2 - dx2 * dy3) / den, hh = (dx1 * dy3 - dx3 * dy1) / den;
  const a = p1[0] - p0[0] + g * p1[0], b = p3[0] - p0[0] + hh * p3[0];
  const d = p1[1] - p0[1] + g * p1[1], e = p3[1] - p0[1] + hh * p3[1];
  return [a / w, b / h, p0[0], d / w, e / h, p0[1], g / w, hh / h];
}
const css = (m: Hm) => `matrix3d(${m[0]},${m[3]},0,${m[6]},${m[1]},${m[4]},0,${m[7]},0,0,1,0,${m[2]},${m[5]},0,1)`;
const project = (m: Hm, x: number, y: number): P => {
  const w = m[6] * x + m[7] * y + 1;
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpP = (a: P, b: P, t: number): P => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
const bil = (q: Quad, f: number, v: number) => lerpP(lerpP(q[0], q[1], f), lerpP(q[3], q[2], f), v);

/** Where a page hinged at the spine is when turned by theta (0 = lying right, PI = lying left). */
function leafQuad(theta: number, right: Quad, left: Quad) {
  const c = Math.cos(theta), s = Math.sin(theta);
  const outer = (v: number): P => {
    const base = c >= 0 ? bil(right, c, v) : bil(left, -c, v);
    return [base[0] - 18 * s, base[1] - (205 + 45 * v) * s];   // lifted toward the camera
  };
  return { spineTop: right[0], spineBot: right[3], outTop: outer(0), outBot: outer(1) };
}

// "Welcome" in page pixels, centred on the right page
const INK_SCALE = 380 / WELCOME.w;
const INK_X = (PAGE_W - WELCOME.w * INK_SCALE) / 2, INK_Y = 300;

/** Catmull-Rom through the baked points, resampled every ~0.6 px, so long swash segments read as curves. */
function smooth(pts: P[], step = 0.6): P[] {
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
  for (let i = 0; i < a.length; i += 2) pts.push([INK_X + a[i] * INK_SCALE, INK_Y + a[i + 1] * INK_SCALE]);
  return smooth(pts);
});
const pathD = (pts: P[]) => "M" + pts.map((p) => p[0].toFixed(2) + " " + p[1].toFixed(2)).join("L");

// Broad nib held at 45°: each stroke is the ribbon swept by the nib edge (thick on down-strokes, hairline
// across), filled once so the edges stay clean. A dash-animated centreline in a mask reveals it as the pen moves.
const NIB_W = 5.6;
const NIB: P = [(NIB_W / 2) * Math.SQRT1_2, -(NIB_W / 2) * Math.SQRT1_2];
const RIBBONS = STROKES.map((pts) => {
  const a = pts.map(([x, y]) => [x - NIB[0], y - NIB[1]] as P);
  const b = pts.map(([x, y]) => [x + NIB[0], y + NIB[1]] as P).reverse();
  return pathD([...a, ...b]) + "Z";
});
const GAP = 70;                       // pen-lift between strokes, as an equivalent length

const ASSETS = ["closed.jpg", "desk.jpg", "quill.webp", "page-right.jpg", "page-left.jpg", "leather.jpg", "crest.webp"].map((f) => "/intro/" + f);

export function JournalIntro() {
  const [open, setOpen] = useState(() => {
    try {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
      return sessionStorage.getItem(SEEN_KEY) !== "1";
    } catch { return true; }
  });
  const root = useRef<HTMLDivElement>(null);
  const tlRef = useRef<gsap.core.Timeline | null>(null);

  const close = () => {
    try { sessionStorage.setItem(SEEN_KEY, "1"); } catch { /* storage blocked: intro shows again next load */ }
    tlRef.current?.kill();
    const el = root.current;
    if (!el) { setOpen(false); return; }
    gsap.to(el, { opacity: 0, duration: 0.35, ease: "power1.out", onComplete: () => setOpen(false) });
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "Enter") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open || !root.current) return;
    const el = root.current;
    const $ = <T extends Element = HTMLElement>(sel: string) => el.querySelector(sel) as unknown as T;
    const stage = $(".ji-stage"), world = $(".ji-world"), closed = $(".ji-closed"), aura = $(".ji-aura");
    const desk = $(".ji-deskmask"), wash = $(".ji-wash"), bar = $(".ji-bar i"), hud = $(".ji-hud");
    const quill = $(".ji-quill"), quillShadow = $(".ji-quill-shadow");
    const leaves = ["cover", "leaf1", "leaf2", "inkleaf"].map((k) => {
      const node = $(`.ji-${k}`);
      return { node, front: node.querySelector(".ji-front") as HTMLElement, back: node.querySelector(".ji-back") as HTMLElement,
        shadeF: node.querySelector(".ji-front .ji-shade") as HTMLElement, shadeB: node.querySelector(".ji-back .ji-shade") as HTMLElement,
        right: k === "cover" ? COVER_R : RIGHT, left: k === "cover" ? COVER_L : LEFT };
    });

    // fit the 1536x1024 stage to cover the viewport
    const fit = () => {
      const s = Math.max(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
      stage.style.transform = `translate(-50%, -50%) scale(${s})`;
    };
    fit();
    window.addEventListener("resize", fit);

    // ink paths: measure each stroke once
    const inkPaths = STROKES.map((_, i) => Array.from(el.querySelectorAll<SVGPathElement>(`.ji-ink [data-s="${i}"]`)));
    const lens = inkPaths.map((ps) => ps[0].getTotalLength());
    const total = lens.reduce((a, b) => a + b, 0) + GAP * (lens.length - 1);
    inkPaths.forEach((ps, i) => ps.forEach((p) => { p.style.strokeDasharray = `${lens[i]} ${lens[i] + 1}`; p.style.strokeDashoffset = `${lens[i]}`; }));
    const H0 = homography(PAGE_W, PAGE_H, [RIGHT[0], RIGHT[1], RIGHT[2], RIGHT[3]]);
    const nibAt = (i: number, d: number): P => {
      const pt = inkPaths[i][0].getPointAtLength(Math.max(0, Math.min(lens[i], d)));
      return project(H0, pt.x, pt.y);
    };
    const inkStart = nibAt(0, 0);

    // ---- state driven by the timeline; render() is a pure function of it ----
    const S = {
      bar: 0, aura: 0, push: 0, closedOp: 1, hud: 1,
      cam1: 0, cam2: 0, desk: 1,
      t0: 0, t1: 0, t2: 0, t3: 0,
      qx: QUILL_REST[0], qy: QUILL_REST[1], qrot: 0, qlift: 0, qop: 1,
      writing: 0, write: 0, wet: 0, wash: 0,
    };
    const thetas = () => [S.t0, S.t1, S.t2, S.t3];

    function render() {
      bar.style.transform = `scaleX(${S.bar})`;
      hud.style.opacity = String(S.hud);
      closed.style.opacity = String(S.closedOp);
      closed.style.transform = `scale(${1 + 0.05 * S.push})`;
      aura.style.opacity = String(S.aura);

      // camera
      let s: number, cx: number, cy: number;
      if (S.cam2 > 0) {
        s = CAM_FULL.s * Math.pow(CAM_ZOOM.s / CAM_FULL.s, S.cam2);
        cx = lerp(CAM_FULL.x, CAM_ZOOM.x, S.cam2); cy = lerp(CAM_FULL.y, CAM_ZOOM.y, S.cam2);
      } else {
        s = lerp(CAM_TIGHT.s, CAM_FULL.s, S.cam1);
        cx = lerp(CAM_TIGHT.x, CAM_FULL.x, S.cam1); cy = lerp(CAM_TIGHT.y, CAM_FULL.y, S.cam1);
      }
      world.style.transform = `translate(${STAGE_W / 2 - cx * s}px, ${STAGE_H / 2 - cy * s}px) scale(${s})`;
      desk.style.opacity = String(S.desk);

      // pages
      thetas().forEach((th, i) => {
        const L = leaves[i];
        const q = leafQuad(th, L.right, L.left);
        const backSide = th > Math.PI / 2;
        L.front.style.display = backSide ? "none" : "block";
        L.back.style.display = backSide ? "block" : "none";
        const quad: [P, P, P, P] = backSide ? [q.outTop, q.spineTop, q.spineBot, q.outBot] : [q.spineTop, q.outTop, q.outBot, q.spineBot];
        L.node.style.transform = css(homography(PAGE_W, PAGE_H, quad));
        L.node.style.zIndex = String(backSide ? 20 + i : 10 - i);
        const shade = String(0.42 * Math.sin(th));
        (backSide ? L.shadeB : L.shadeF).style.opacity = shade;
      });

      // ink + quill
      let nib: P = [S.qx, S.qy], lift = S.qlift;
      let d = S.write * total;
      for (let i = 0; i < lens.length; i++) {
        const shown = Math.max(0, Math.min(lens[i], d));
        inkPaths[i].forEach((p) => { p.style.strokeDashoffset = String(lens[i] - shown); });
        if (S.writing) {
          if (d >= 0 && d <= lens[i]) { nib = nibAt(i, d); lift = 0.08; }
          else if (d > lens[i] && d < lens[i] + GAP && i < lens.length - 1) {
            const t = (d - lens[i]) / GAP;
            nib = lerpP(nibAt(i, lens[i]), nibAt(i + 1, 0), t * t * (3 - 2 * t));
            lift = 0.08 + 0.5 * Math.sin(Math.PI * t);
          }
        }
        d -= lens[i] + GAP;
      }
      (el.querySelector(".ji-glisten") as HTMLElement).style.opacity = String(S.wet);
      const rot = S.writing ? S.qrot + 2.5 * Math.sin(S.write * Math.PI * 5) : S.qrot;
      const tf = `translate(${nib[0] - QUILL_REST[0]}px, ${nib[1] - QUILL_REST[1]}px) rotate(${rot}deg) scale(${1 + 0.07 * lift})`;
      quill.style.transform = tf;
      quill.style.opacity = String(S.qop);
      quillShadow.style.transform = `translate(${nib[0] - QUILL_REST[0] + 34 * lift}px, ${nib[1] - QUILL_REST[1] + 26 * lift}px) rotate(${rot}deg)`;
      quillShadow.style.opacity = String(S.qop * (0.55 - 0.25 * lift));
      wash.style.opacity = String(S.wash);
    }

    // ---- the 10-second timeline ----
    const PI = Math.PI;
    const tl = gsap.timeline({ paused: true, defaults: { lazy: false }, onUpdate: render, onComplete: close });   // lazy:false so seeks render this frame
    tl.to(S, { bar: 1, duration: 1.4, ease: "power1.inOut" }, 0)
      .to(S, { aura: 1, duration: 0.7, ease: EASE }, 0.1)
      .to(S, { push: 1, duration: 1.5, ease: "none" }, 0)
      // 1.5 - 3.0: the cover and two pages turn while the camera pulls back to the spread
      .to(S, { hud: 0, duration: 0.4, ease: "power1.out" }, 1.45)
      .to(S, { closedOp: 0, duration: 0.4, ease: "power1.inOut" }, 1.5)
      .to(S, { t0: PI, duration: 1.0, ease: EASE }, 1.55)
      .to(S, { desk: 0, duration: 0.3, ease: "power1.in" }, 2.05)
      .to(S, { cam1: 1, duration: 1.45, ease: EASE }, 1.55)
      .to(S, { t1: PI, duration: 0.6, ease: EASE }, 2.15)
      .to(S, { t2: PI, duration: 0.6, ease: EASE }, 2.38)
      // 3.0 - 4.1: the quill lifts, dips into the ink, and comes to the page
      .to(S, { qlift: 1, qrot: -6, duration: 0.25, ease: "power2.out" }, 3.0)
      .to(S, { qx: INKWELL[0], qy: INKWELL[1] - 6, qrot: 10, duration: 0.38, ease: EASE }, 3.2)
      .to(S, { qy: INKWELL[1] + 16, qlift: 0.55, duration: 0.09, ease: "power1.in", yoyo: true, repeat: 3 }, 3.58)
      .to(S, { qx: inkStart[0], qy: inkStart[1], qrot: 30, qlift: 0.08, duration: 0.42, ease: EASE }, 3.95)
      // 4.4 - 6.3: writing
      .set(S, { writing: 1 }, 4.38)
      .to(S, { wet: 1, duration: 0.2 }, 4.38)
      .to(S, { write: 1, duration: 1.95, ease: "none" }, 4.38)
      .set(S, { writing: 0, qx: () => nibAt(lens.length - 1, lens[lens.length - 1])[0], qy: () => nibAt(lens.length - 1, lens[lens.length - 1])[1] }, 6.33)
      .to(S, { qx: "+=260", qy: "-=170", qrot: 18, qlift: 1.3, qop: 0, duration: 0.45, ease: "power2.in" }, 6.33)
      // 6.5 - 10: the written page turns, the camera dives into the fresh page, parchment fills the screen
      .to(S, { t3: PI, duration: 0.7, ease: EASE }, 6.55)
      .to(S, { wet: 0, duration: 1.2, ease: "power1.out" }, 6.0)
      .to(S, { cam2: 1, duration: 2.5, ease: EASE }, 7.0)
      .to(S, { wash: 1, duration: 0.8, ease: "power1.inOut" }, 8.6)
      .to(el, { opacity: 0, duration: 0.55, ease: "power1.out" }, 9.45);
    tlRef.current = tl;
    if (import.meta.env.DEV) (window as unknown as { __journalTl: gsap.core.Timeline }).__journalTl = tl;
    render();

    // start once the photos are decoded (or after 2.5 s regardless), so the first frames never stutter
    let started = false, disposed = false;   // a killed timeline would revive if play() ran after cleanup
    const start = () => { if (started || disposed) return; started = true; requestAnimationFrame(() => { if (!disposed) tl.play(0); }); };
    Promise.all(ASSETS.map((src) => { const i = new Image(); i.src = src; return i.decode().catch(() => undefined); })).then(start);
    const fallback = window.setTimeout(start, 2500);

    return () => { disposed = true; window.removeEventListener("resize", fit); window.clearTimeout(fallback); tl.kill(); };
  }, [open]);

  if (!open) return null;
  const ink = STROKES.map((pts, i) => pathD(pts));
  const face = (side: "front" | "back", children?: React.ReactNode, extra = "") => (
    <div className={`ji-${side} ${extra}`}>{children}<div className="ji-shade" /></div>
  );
  return (
    <div ref={root} className="ji-root" role="dialog" aria-label="ClearScript intro: a journal opens and a quill writes Welcome">
      <div className="ji-stage">
        <div className="ji-world">
          <img className="ji-desk" src="/intro/desk.jpg" alt="" draggable={false} />
          <div className="ji-deskmask" />
          <div className="ji-leaf ji-cover">
            {face("front", <><img className="ji-crest" src="/intro/crest.webp" alt="" draggable={false} /><div className="ji-tooling" /></>, "ji-leather")}
            {face("back", null, "ji-page-l")}
          </div>
          <div className="ji-leaf ji-leaf1">{face("front", null, "ji-page-r")}{face("back", null, "ji-page-l")}</div>
          <div className="ji-leaf ji-leaf2">{face("front", null, "ji-page-r")}{face("back", null, "ji-page-l")}</div>
          <div className="ji-leaf ji-inkleaf">
            {face("front", (
              <svg className="ji-ink" width={PAGE_W} height={PAGE_H} viewBox={`0 0 ${PAGE_W} ${PAGE_H}`} aria-hidden="true">
                <defs>
                  {ink.map((d, i) => (
                    <mask key={i} id={`ji-reveal-${i}`} maskUnits="userSpaceOnUse" x="0" y="0" width={PAGE_W} height={PAGE_H}>
                      <path className="ji-reveal" data-s={i} d={d} />
                    </mask>
                  ))}
                </defs>
                <g className="ji-ink-fill">
                  {RIBBONS.map((d, i) => <path key={i} d={d} mask={`url(#ji-reveal-${i})`} />)}
                </g>
                <g className="ji-glisten" transform="translate(0.7 -0.7)">
                  {ink.map((d, i) => <path key={i} data-s={i} d={d} />)}
                </g>
              </svg>
            ), "ji-page-r")}
            {face("back", null, "ji-page-l")}
          </div>
          <img className="ji-quill-shadow" src="/intro/quill.webp" alt="" draggable={false} />
          <img className="ji-quill" src="/intro/quill.webp" alt="" draggable={false} />
        </div>
        <div className="ji-closed">
          <img src="/intro/closed.jpg" alt="" draggable={false} />
          <div className="ji-aura" />
        </div>
        <div className="ji-wash" />
      </div>
      <div className="ji-hud">
        <span className="ji-title">ClearScript</span>
        <span className="ji-bar"><i /></span>
      </div>
      <button className="ji-skip" onClick={close}>Skip intro <kbd>Esc</kbd></button>
    </div>
  );
}
