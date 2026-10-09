// First page when Supabase sign-in is configured: a parchment sheet on the desk with Google and email sign-in.
// "Continue without an account" keeps the old behaviour (history stays in this browser).
import { useState } from "react";
import { SignInForm } from "../components/AccountMenu";
import { useT } from "../i18n";
import { useAuth } from "../lib/auth";

export function LoginPage() {
  const { t } = useT();
  const { continueAsGuest } = useAuth();
  const [mode, setMode] = useState<"in" | "up">("in");
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="cs-sheet w-full max-w-md bg-surface px-6 py-8 shadow-pop sm:px-8">
        <p className="cs-wordmark text-center text-sm text-accent-text">ClearScript</p>
        <h1 className="cs-title mt-2 text-center text-ink">{t(mode === "in" ? "auth.signInTitle" : "auth.signUpTitle")}</h1>
        <p className="mt-2 mb-6 text-center text-sm text-body">{t("auth.pageDesc")}</p>
        <SignInForm mode={mode} setMode={setMode} />
        <div className="mt-6 border-t border-line pt-4 text-center">
          <button type="button" onClick={continueAsGuest}
            className="min-h-10 rounded-md text-sm text-muted underline-offset-2 hover:text-body hover:underline">
            {t("auth.guest")}
          </button>
        </div>
      </div>
    </main>
  );
}
