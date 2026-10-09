// Sign-in state for the whole app. Firebase keeps the session in the browser, so a refresh stays signed in.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  createUserWithEmailAndPassword, onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword,
  signInWithPopup, signOut, updateProfile, type User,
} from "firebase/auth";
import { auth, firebaseEnabled, google } from "./firebase";

type Ctx = {
  enabled: boolean;     // false when Firebase isn't configured: hide every sign-in control
  ready: boolean;       // false until Firebase has said whether someone is signed in
  user: User | null;
  signInGoogle: () => Promise<void>;
  signInEmail: (email: string, password: string) => Promise<void>;
  signUpEmail: (email: string, password: string, name?: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthCtx = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(!firebaseEnabled);
  const [, rerender] = useState(0);

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, (u) => { setUser(u); setReady(true); });
  }, []);

  const need = () => { if (!auth) throw new Error("Firebase is not configured"); return auth; };
  const value: Ctx = {
    enabled: firebaseEnabled,
    ready,
    user,
    signInGoogle: async () => { await signInWithPopup(need(), google); },
    signInEmail: async (email, password) => { await signInWithEmailAndPassword(need(), email, password); },
    signUpEmail: async (email, password, name) => {
      const cred = await createUserWithEmailAndPassword(need(), email, password);
      if (name?.trim()) {
        await updateProfile(cred.user, { displayName: name.trim() });
        rerender((n) => n + 1); // updateProfile changes the same User object, after onAuthStateChanged fired
      }
    },
    resetPassword: async (email) => { await sendPasswordResetEmail(need(), email); },
    logout: async () => { await signOut(need()); },
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth() outside <AuthProvider>");
  return ctx;
}

/** Firebase error code (e.g. "auth/wrong-password") from anything thrown by the auth calls. */
export const authCode = (e: unknown) =>
  typeof e === "object" && e && "code" in e && typeof e.code === "string" ? e.code : "unknown";
