import { useEffect, useState } from "react";
import { ScanText } from "lucide-react";
import { Kbd } from "./ui";

const PAGES = {
  welcome: { file: "welcome-pen.html", title: "A fountain pen writing the word welcome" },
  musing: { file: "musing-pen.html", title: "A fountain pen writing Methinks, Conceive, Rumination and Apprehension, one after another" },
};

/** The 3D fountain pen (public/pen/*-pen.html: Three.js + GSAP, libs served locally so it works offline).
 *  "welcome" plays once (intro); "musing" loops through four old words (loading view). */
export function PenAnimation({ page = "musing", className = "" }: { page?: keyof typeof PAGES; className?: string }) {
  return (
    <iframe
      src={`/pen/${PAGES[page].file}?embed`}
      title={PAGES[page].title}
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
    <div className={`fixed inset-0 z-50 bg-[#efe6d5] transition-opacity duration-400 ease-in-out ${leaving ? "opacity-0" : "opacity-100"}`}>
      <PenAnimation page="welcome" className="h-full" />
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2 text-[#231a12]">
          <span className="grid size-6 place-items-center rounded-md bg-brand text-white"><ScanText className="size-3.5" /></span>
          <span className="font-display text-[15px] font-semibold tracking-[0.06em]">ClearScript</span>
          <span className="font-serif text-[15px] italic text-[#6b5a47]">messy handwriting in, trusted text out</span>
        </div>
        <button
          onClick={close}
          className="pointer-events-auto flex items-center gap-2 rounded-lg border border-[#c8b293] bg-[#faf6ee]/85 px-3 py-1.5 text-[12px] font-medium text-[#231a12] backdrop-blur transition-all duration-150 ease-in-out hover:bg-[#faf6ee]"
        >
          Skip intro <Kbd>Esc</Kbd>
        </button>
      </div>
    </div>
  );
}
