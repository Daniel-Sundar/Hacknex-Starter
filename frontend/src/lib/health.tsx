import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getJSON } from "./api";

export type Health = {
  state: "checking" | "online" | "offline";
  provider?: string;
  readers?: string[];
  limits: { maxUploadMb: number; docsMaxUploadMb: number };
};

const DEFAULT: Health = { state: "checking", limits: { maxUploadMb: 15, docsMaxUploadMb: 10 } };
const Ctx = createContext<Health>(DEFAULT);

/** GET /api/health once on load: server reachable?, which models, upload limits. */
export function HealthProvider({ children }: { children: ReactNode }) {
  const [h, setH] = useState<Health>(DEFAULT);
  useEffect(() => {
    getJSON("/api/health")
      .then((r) => setH({
        state: "online",
        provider: r.provider,
        readers: Array.isArray(r.readers) ? r.readers : undefined,
        limits: {
          maxUploadMb: Number(r.limits?.max_upload_mb) || DEFAULT.limits.maxUploadMb,
          docsMaxUploadMb: Number(r.limits?.docs_max_upload_mb) || DEFAULT.limits.docsMaxUploadMb,
        },
      }))
      .catch(() => setH((x) => ({ ...x, state: "offline" })));
  }, []);
  return <Ctx.Provider value={h}>{children}</Ctx.Provider>;
}

export const useHealth = () => useContext(Ctx);
