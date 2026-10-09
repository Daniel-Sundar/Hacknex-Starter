// Header account control: "Sign in" when signed out (opens the sign-in dialog), the user's avatar when
// signed in (opens a small account dialog with Sign out). Renders nothing when Firebase isn't configured.
import { useEffect, useState, type FormEvent } from "react";
import { Cloud, Loader2, LogIn, LogOut } from "lucide-react";
import { Button, Dialog, Input, Notice, useToast } from "./ui";
import { useT, type MessageKey } from "../i18n";
import { authCode, useAuth } from "../lib/auth";
import { auth } from "../lib/firebase";

const ERRORS: Record<string, MessageKey> = {
  "auth/invalid-credential": "auth.err.invalid",
  "auth/wrong-password": "auth.err.invalid",
  "auth/user-not-found": "auth.err.invalid",
  "auth/invalid-login-credentials": "auth.err.invalid",
  "auth/email-already-in-use": "auth.err.exists",
  "auth/weak-password": "auth.err.weak",
  "auth/invalid-email": "auth.err.email",
  "auth/missing-email": "auth.err.email",
  "auth/popup-closed-by-user": "auth.err.popup",
  "auth/cancelled-popup-request": "auth.err.popup",
  "auth/popup-blocked": "auth.err.blocked",
  "auth/unauthorized-domain": "auth.err.domain",
  "auth/operation-not-allowed": "auth.err.method",
  "auth/network-request-failed": "auth.err.network",
  "auth/too-many-requests": "auth.err.tooMany",
};
const errorKey = (e: unknown): MessageKey => ERRORS[authCode(e)] ?? "auth.err.unknown";

export function AccountMenu() {
  const { t } = useT();
  const { enabled, ready, user, logout } = useAuth();
  const { toast } = useToast();
  const [signInOpen, setSignInOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  if (!enabled) return null;
  if (!ready) return <span className="grid size-10 place-items-center"><Loader2 className="size-4 animate-spin text-muted" aria-label={t("common.loading")} /></span>;

  if (!user) {
    return (
      <>
        <Button size="md" variant="secondary" icon={<LogIn className="size-4" aria-hidden="true" />} onClick={() => setSignInOpen(true)}
          aria-label={t("auth.signIn")}>
          <span className="max-sm:sr-only">{t("auth.signIn")}</span>
        </Button>
        <SignInDialog open={signInOpen} onClose={() => setSignInOpen(false)} />
      </>
    );
  }

  const name = user.displayName || user.email || "?";
  return (
    <>
      <button type="button" onClick={() => setAccountOpen(true)} title={t("auth.account", { name })} aria-label={t("auth.account", { name })}
        className="grid size-10 place-items-center rounded-full">
        <Avatar photo={user.photoURL} name={name} />
      </button>
      <Dialog open={accountOpen} onClose={() => setAccountOpen(false)} title={t("auth.account", { name })}
        footer={<>
          <Button onClick={() => setAccountOpen(false)}>{t("common.close")}</Button>
          <Button variant="danger" icon={<LogOut className="size-4" aria-hidden="true" />}
            onClick={async () => { setAccountOpen(false); await logout(); toast(t("auth.signedOut")); }}>
            {t("auth.signOut")}
          </Button>
        </>}>
        <div className="flex items-center gap-3">
          <Avatar photo={user.photoURL} name={name} large />
          <div className="min-w-0">
            {user.displayName && <p className="truncate text-sm font-semibold text-ink">{user.displayName}</p>}
            {user.email && <p className="truncate text-sm text-body">{user.email}</p>}
          </div>
        </div>
        <p className="mt-4 flex items-center gap-2 text-sm text-body"><Cloud className="size-4 text-accent-text" aria-hidden="true" />{t("auth.synced")}</p>
      </Dialog>
    </>
  );
}

function Avatar({ photo, name, large }: { photo: string | null; name: string; large?: boolean }) {
  const [broken, setBroken] = useState(false);
  const box = large ? "size-12 text-lg" : "size-8 text-sm";
  if (photo && !broken) {
    // Google profile photos refuse requests that carry a Referer header.
    return <img src={photo} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} className={`${box} rounded-full border border-line object-cover`} />;
  }
  return <span aria-hidden="true" className={`${box} grid place-items-center rounded-full bg-accent font-semibold text-accent-fg`}>{name.trim().charAt(0).toUpperCase()}</span>;
}

function SignInDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useT();
  const { signInGoogle, signInEmail, signUpEmail, resetPassword } = useAuth();
  const { toast } = useToast();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"google" | "email" | "reset" | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => { if (!open) { setError(null); setInfo(null); setPassword(""); setBusy(null); } }, [open]);

  async function run(kind: "google" | "email", fn: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    setInfo(null);
    try {
      await fn();
      onClose();
      const u = auth?.currentUser;
      toast(t("auth.welcome", { name: u?.displayName || u?.email || email.trim() }), "ok");
    } catch (e) {
      setError(errorKey(e));
    } finally {
      setBusy(null);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    run("email", () => (mode === "in" ? signInEmail(email.trim(), password) : signUpEmail(email.trim(), password, name)));
  }

  async function forgot() {
    if (!email.trim()) { setError("auth.resetNeedEmail"); return; }
    setBusy("reset");
    setError(null);
    try {
      await resetPassword(email.trim());
      setInfo(t("auth.resetSent", { email: email.trim() }));
    } catch (e) {
      // Don't reveal whether an account exists: only show problems with the request itself.
      const k = errorKey(e);
      if (k === "auth.err.invalid") setInfo(t("auth.resetSent", { email: email.trim() }));
      else setError(k);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} width="26rem" title={t(mode === "in" ? "auth.signInTitle" : "auth.signUpTitle")} description={t("auth.desc")}>
      <div className="space-y-4">
        <Button className="w-full" loading={busy === "google"} disabled={!!busy} onClick={() => run("google", signInGoogle)} icon={<GoogleMark />}>
          {t("auth.google")}
        </Button>
        <div className="flex items-center gap-3 text-xs text-muted" aria-hidden="true">
          <span className="h-px flex-1 bg-line" />{t("auth.or")}<span className="h-px flex-1 bg-line" />
        </div>
        <form onSubmit={submit} className="space-y-3" noValidate>
          {mode === "up" && <Input label={t("auth.name")} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />}
          <Input label={t("auth.email")} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input label={t("auth.password")} type="password" required minLength={6}
            autoComplete={mode === "in" ? "current-password" : "new-password"}
            hint={mode === "up" ? t("auth.passwordHint") : undefined}
            value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <Notice tone="danger">{t(error)}</Notice>}
          {info && <Notice tone="ok">{info}</Notice>}
          <Button type="submit" variant="primary" className="w-full" loading={busy === "email"} disabled={!!busy || !email.trim() || !password}>
            {t(mode === "in" ? "auth.submitIn" : "auth.submitUp")}
          </Button>
        </form>
        <div className="flex flex-wrap justify-between gap-2 text-sm">
          <button type="button" className="min-h-10 rounded-md font-medium text-accent-text underline-offset-2 hover:underline"
            onClick={() => { setMode(mode === "in" ? "up" : "in"); setError(null); setInfo(null); }}>
            {t(mode === "in" ? "auth.toSignUp" : "auth.toSignIn")}
          </button>
          {mode === "in" && (
            <button type="button" disabled={!!busy} className="min-h-10 rounded-md text-body underline-offset-2 hover:underline" onClick={forgot}>
              {t("auth.forgot")}
            </button>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-4" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
