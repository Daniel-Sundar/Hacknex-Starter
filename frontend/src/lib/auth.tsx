// Sign-in state for the whole app (Supabase Auth). The session is kept in the browser, so a refresh stays
// signed in; Google sign-in leaves for Google and comes back to this page.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { User as SbUser } from "@supabase/supabase-js";
import { supabase, supabaseEnabled } from "./supabase";

export type User = { uid: string; email: string | null; displayName: string | null; photoURL: string | null };

const toUser = (u: SbUser | null | undefined): User | null => u ? {
  uid: u.id,
  email: u.email ?? null,
  displayName: (u.user_metadata?.full_name || u.user_metadata?.name || null) as string | null,
  photoURL: (u.user_metadata?.avatar_url || u.user_metadata?.picture || null) as string | null,
} : null;

type Ctx = {
  enabled: boolean;     // false when Supabase isn't configured: no login page, no sign-in controls
  ready: boolean;       // false until we know whether someone is signed in
  user: User | null;
  guest: boolean;       // chose "continue without an account" on the login page (this tab only)
  continueAsGuest: () => void;
  signInGoogle: () => Promise<void>;
  signInEmail: (email: string, password: string) => Promise<User | null>;
  signUpEmail: (email: string, password: string, name?: string) => Promise<User | null>;
  resetPassword: (email: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthCtx = createContext<Ctx | null>(null);

const need = () => { if (!supabase) throw new Error("Supabase is not configured"); return supabase; };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const check = (r: { data?: any; error: unknown }) => { if (r.error) throw r.error; return r.data; };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(!supabaseEnabled);
  const [guest, setGuest] = useState(() => { try { return sessionStorage.getItem("cs-guest") === "1"; } catch { return false; } });

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => { setUser(toUser(data.session?.user)); setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => { setUser(toUser(s?.user)); setReady(true); });
    return () => data.subscription.unsubscribe();
  }, []);

  const value: Ctx = {
    enabled: supabaseEnabled,
    ready,
    user,
    guest,
    continueAsGuest: () => { try { sessionStorage.setItem("cs-guest", "1"); } catch { /* private mode */ } setGuest(true); },
    signInGoogle: async () => {
      check(await need().auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin + window.location.pathname } }));
    },
    signInEmail: async (email, password) => toUser(check(await need().auth.signInWithPassword({ email, password })).user),
    signUpEmail: async (email, password, name) => {
      const d = check(await need().auth.signUp({ email, password, options: { data: name?.trim() ? { full_name: name.trim() } : {} } }));
      // With "Confirm email" on, Supabase returns no session until the link in the email is opened.
      if (!d.session) throw { code: "confirm_email" };
      return toUser(d.user);
    },
    resetPassword: async (email) => { check(await need().auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })); },
    logout: async () => {
      try { sessionStorage.removeItem("cs-guest"); } catch { /* private mode */ }
      setGuest(false);
      check(await need().auth.signOut());
    },
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth() outside <AuthProvider>");
  return ctx;
}

/** Supabase error code (e.g. "invalid_credentials") from anything thrown by the auth calls. */
export const authCode = (e: unknown) => {
  if (typeof e !== "object" || !e) return "unknown";
  const o = e as { code?: unknown; status?: number; name?: string; message?: string };
  if (typeof o.code === "string") return o.code;
  if (o.name === "AuthRetryableFetchError" || o.message === "Failed to fetch") return "network";
  if (o.status === 429) return "over_request_rate_limit";
  return "unknown";
};
