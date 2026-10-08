const PAGES = {
  musing: { file: "musing-pen.html", title: "A fountain pen writing Methinks, Conceive, Rumination and Apprehension, one after another" },
};

/** The 3D fountain pen (public/pen/*-pen.html: Three.js + GSAP, libs served locally so it works offline).
 *  "musing" loops through four old words (loading view). */
export function PenAnimation({ page = "musing", className = "" }: { page?: keyof typeof PAGES; className?: string }) {
  return (
    <iframe
      src={`/pen/${PAGES[page].file}?embed`}
      title={PAGES[page].title}
      className={`block w-full border-0 ${className}`}
    />
  );
}
