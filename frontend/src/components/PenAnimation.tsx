import { useEffect, useState } from "react";
import { ScanText } from "lucide-react";
import { Kbd } from "./ui";

/** The 3D fountain pen (public/pen/*-pen.html: Three.js + GSAP, libs served locally so it works offline). */
export function PenAnimation({ word = "thinking", loop = false, className = "" }: { word?: "thinking" | "welcome"; loop?: boolean; className?: string }) {
  return (
    <iframe
      src={`/pen/${word}-pen.html?embed${loop ? "&loop" : ""}`}
      title={`A fountain pen writing the word ${word}`}
      className={`block w-full border-0 ${className}`}
    />
  );
}

const SEEN_KEY = "clearscript-intro-seen";

/** Full-screen intro: the pen uncaps and writes "welcome", then the app appears. Once per browser session. */
export function PenIntro() {
  const [open, setOpen] = useState(() => {
    try {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
      return sessionStorage.getItem(SEEN_KEY) !== "1";
    } catch { return true; }
  });
  const [leaving, setLeaving] = useState(false);

  const close = () => {
    setLeaving(true);
    try { sessionStorage.setItem(SEEN_KEY, "1"); } catch { /* storage blocked: intro shows again next load */ }
    setTimeout(() => setOpen(false), 400);
  };

  useEffect(() => {
    if (!open) return;
    const onMsg = (e: MessageEvent) => { if (e.data?.type === "pen:done") setTimeout(close, 500); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "Enter") close(); };
    window.addEventListener("message", onMsg);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("message", onMsg); window.removeEventListener("keydown", onKey); };
  }, [open]);

  if (!open) return null;
  return (
    <div className={`fixed inset-0 z-50 bg-[#f6f2ea] transition-opacity duration-400 ease-in-out ${leaving ? "opacity-0" : "opacity-100"}`}>
      <PenAnimation word="welcome" className="h-full" />
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2 text-[#1c1917]">
          <span className="grid size-6 place-items-center rounded-md bg-brand text-white"><ScanText className="size-3.5" /></span>
          <span className="text-[14px] font-semibold tracking-tight">ClearScript</span>
          <span className="text-[13px] text-[#57534e]">messy handwriting in, trusted text out</span>
        </div>
        <button
          onClick={close}
          className="pointer-events-auto flex items-center gap-2 rounded-lg border border-[#d6d3d1] bg-white/80 px-3 py-1.5 text-[12px] font-medium text-[#1c1917] backdrop-blur transition-all duration-150 ease-in-out hover:bg-white"
        >
          Skip intro <Kbd>Esc</Kbd>
        </button>
      </div>
    </div>
  );
}
