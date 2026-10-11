// First page when Supabase sign-in is configured: a parchment sheet on the desk with Google and email sign-in.
// "Continue without an account" keeps the old behaviour (history stays in this browser).
import { useState } from "react";
import { ScanText } from "lucide-react";
import { SignInForm } from "../components/AccountMenu";
import { useT } from "../i18n";
import { useAuth } from "../lib/auth";

export function LoginPage() {
  const { t } = useT();
  const { continueAsGuest } = useAuth();
  const [mode, setMode] = useState<"in" | "up">("in");
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="cs-on-canvas mb-8 flex flex-col items-center gap-3 text-center">
          <span aria-hidden="true" className="cs-primary grid size-12 place-items-center rounded-2xl text-accent-fg"><ScanText className="size-6" /></span>
          <p className="cs-wordmark text-sm text-muted">ClearScript</p>
        </div>
        <div className="cs-glass-elevated rounded-[1.5rem] px-6 py-8 sm:px-8">
          <h1 className="cs-title text-center">{t(mode === "in" ? "auth.signInTitle" : "auth.signUpTitle")}</h1>
          <p className="mt-2 mb-6 text-center text-sm text-body">{t("auth.pageDesc")}</p>
          <SignInForm mode={mode} setMode={setMode} />
          <div className="mt-6 border-t border-line pt-4 text-center">
            <button type="button" onClick={continueAsGuest}
              className="min-h-10 rounded-md text-sm text-muted underline-offset-2 hover:text-body hover:underline">
              {t("auth.guest")}
            </button>
          </div>
        </div>
        <p className="cs-on-canvas mt-6 text-center text-xs text-muted">
          {t("auth.legalPrefix")}{" "}
          <a href="#/terms" className="font-medium text-accent-text underline underline-offset-2">{t("legal.footer.terms")}</a>
          {" · "}
          <a href="#/privacy" className="font-medium text-accent-text underline underline-offset-2">{t("legal.footer.privacy")}</a>
        </p>
      </div>
    </main>
  );
}
