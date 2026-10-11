# ClearScript security notes

Last reviewed 2026-10-11 (commit after `checkpoint/before-security-pass`). This is a hackathon prototype. Repository checks
cannot prove the absence of vulnerabilities; treat this as a living record, not a guarantee.

Report a problem: [contact email to be added by the team].

## What the app is

| Part | What it is |
|---|---|
| Backend | FastAPI (`backend/app`), one process on Render free tier. No admin pages, no shell commands, no SQL built from input. |
| Frontend | React static site on Render. Hash routes: `#/clearscript`, `#/docs`, `#/privacy`, `#/terms`. |
| AI | Vision models (Gemini, Groq, OpenRouter) read pages. Text models do a constrained context fix, the medicines table and Docs Q&A answers. No model can call tools or take actions. |
| Data | Supabase: `readings_cache` and `writer_words` (server only, secret key), `history` (browser, publishable key, row-level security). Docs Q&A lives in server memory. |
| Users | Optional Supabase sign-in (Google, email). Not multi-tenant beyond "each person sees only their own data". |

## Findings from the 2026-10-11 pass

| # | Severity | Status | Finding | Fix | Verified by |
|---|---|---|---|---|---|
| 1 | High | Fixed | Docs Q&A was one shared store: any visitor could list, read (by asking), delete or clear everyone's documents. | Every document is tagged with its owner; list, search, ask, delete and clear only touch the caller's own. Per-owner cap of 4,000 passages. | `test_docs_are_private_to_their_owner`, `test_same_file_name_from_two_users_does_not_collide` |
| 2 | Medium | Fixed | Writer profiles were keyed only by the typed name, so anyone could add words to another person's "dr-kumar" profile and steer their context fix. | Profiles are stored under a hash of the caller plus the name. | `test_writer_profiles_are_per_user` |
| 3 | Medium | Fixed | The API had no notion of who was calling. | `app/identity.py`: a Supabase access token is verified with Supabase Auth (cached 5 min) and gives `u:<user id>`; signed out, a random 144-bit browser id (`X-Client-Id`) gives `c:<id>`. A token that fails verification is refused (401), never downgraded. | `test_bad_token_is_refused_not_downgraded`, `test_verified_token_owns_its_docs_across_devices`, `test_docs_need_an_identity` |
| 4 | Medium | Fixed | `DELETE /api/docs` and `/api/docs/{name}` had no rate limit. | Added the `hw_tools` limit (same limiter the audit test exercises). | not tested on these two routes directly |
| 5 | Medium | Fixed | Unbounded JSON fields (`marked`, `words`, `answer`) allowed very large model prompts (cost and memory). | Explicit length limits on every request model, plus a 30 MB body cap. Only declared fields are read (no mass assignment). | `test_extra_and_oversized_fields_are_rejected_or_ignored`, `test_oversized_body_is_refused_early` |
| 6 | Low | Fixed | Raw provider error text was returned to the browser (`reason`). It could contain request details. | Key-shaped strings, `Bearer` values and `key=` parameters are redacted before leaving the server. | `test_provider_errors_are_redacted` |
| 7 | Low | Fixed | Docs Q&A put document text straight into the prompt (indirect prompt injection). Impact was limited (no tools, answer shown as Markdown with HTML and images off). | A system message says passages are untrusted data; passages are fenced in a documents block that they cannot close. | `test_document_text_is_fenced_as_data` |
| 8 | Low | Fixed | No security headers on the API or the site; `/docs` and `/openapi.json` were public. | API: nosniff, `frame-ancestors 'none'`, `default-src 'none'`, no-referrer, HSTS over HTTPS, `no-store`, request ids. Site (`render.yaml`): CSP without inline scripts or `unsafe-*`, HSTS, nosniff, `X-Frame-Options`, Referrer- and Permissions-Policy. API docs only with `API_DOCS=1`. | `test_security_headers_and_request_id`, `test_hsts_only_over_https`, `test_no_public_api_docs`; site CSP loaded in Chromium with zero violations |
| 9 | Low | Fixed | `/api/health` exposed the total number of stored passages across all users. | Removed. | `test_health_lists_readers_and_limits` |
| 10 | Info | Added | No security audit trail. | `app/audit.py`: JSON lines on the `clearscript.audit` logger: `rate_limited`, `auth.token_rejected`, `auth.no_identity`, `docs.upload`, `docs.delete`, `docs.clear`, `writer.answer`. Actor is a hash, never an id, email or token. | `test_audit_log_records_rate_limits_without_secrets` |
| 11 | Info | Added | `history` rows had no size limit; browser roles had no explicit revoke on server-only tables. | `supabase.sql` hardening block: size checks and revokes. **Run it once in the Supabase SQL editor.** | not run against the live database |

Already in place and kept: content-sniffed uploads (not by file name), size limits, HEIC and decompression-bomb guards,
DOCX zip-bomb and XML-entity guards, per-IP rate limits with `TRUST_PROXY`, a cap on concurrent reads, writer names
sanitised against path tricks, row-level security on `history`, keys only in env, Markdown answers with HTML and images off.

## Not applicable here

Command injection (no subprocess or shell calls), SQL injection (PostgREST with fixed filters, no SQL strings), insecure
deserialization (JSON only; no pickle or YAML loading of input), server-set cookies and CSRF (no cookies; the API uses
headers, so a cross-site form cannot send them), admin dashboards (none exist), AI tool execution (models have no tools),
UTM tracking (no campaigns or analytics, so nothing was added), multi-tenant organisations (one person, one owner key).

## Known remaining risks

- **Signed-out isolation rests on a browser secret.** Anyone who copies a browser's `cs-client-id` from its local
  storage can see that browser's Docs Q&A documents. Sign in for anything sensitive.
- **Supabase session in localStorage.** supabase-js keeps the session there, so an XSS bug would expose it. The CSP and
  React's escaping reduce that risk; moving to httpOnly cookies would need a backend auth proxy.
- **Old writer profiles are not migrated.** Words saved before this change under a bare name are no longer used.
- **Rate limits are per process and per IP**, in memory. They reset on restart and do not cover several instances.
- **Reading cache is shared by image fingerprint.** Someone who already has the exact same image file gets the cached
  reading. They learn nothing they could not read from the image.
- **No encryption at rest beyond what Supabase and Render provide by default.** Not verified from here.
- **Alerting is not set up.** Audit lines go to Render logs only. Real alerts need a log drain (for example Render to
  Better Stack or Datadog) with rules on `rate_limited` and `auth.token_rejected` spikes.
- **Google OAuth** is handled by Supabase. supabase-js runs in its default implicit flow (tokens come back in the URL
  fragment). Switching to PKCE (`auth: { flowType: "pkce" }` in `src/lib/supabase.ts`) is stronger but changes how
  email confirmation links work, so it was not switched without a live test. Check in Supabase that *Redirect URLs*
  lists only the real site, and that Google's OAuth client lists only Supabase's callback URL.

## Backups and restore

| Data | Where | Backup today | If lost |
|---|---|---|---|
| `history` | Supabase | Supabase daily backups (Pro plan and up only). On the free plan: none. | Users lose saved results. |
| `writer_words` | Supabase + server disk | Same as above; the server copy is wiped on each Render deploy. | Hints get weaker; nothing breaks. |
| `readings_cache` | Supabase + server disk | Not needed: it is a cache. | Pages are read again (costs quota). |
| Docs Q&A | Server memory | None by design. | Users upload again. |

Manual backup on the free plan (from a trusted machine, never commit the output):

```bash
# Supabase > Project Settings > Database > Connection string (URI). Keep it out of the repo and out of chat.
pg_dump "$SUPABASE_DB_URL" --data-only --table=public.history --table=public.writer_words > clearscript-backup.sql
```

Restore: into a **new, empty** Supabase project first, run `backend/supabase.sql`, then
`psql "$NEW_DB_URL" < clearscript-backup.sql`, check row counts, and only then point the app at it. Never test a
restore against the live project. Targets for a prototype: RPO 24 hours, RTO 1 hour [to be agreed by the team].
No restore has been tested yet.

## Deployment checklist

1. Redeploy both Render services from `feat/handwriting-mvp`. The static site picks up the new headers from `render.yaml`
   only through a Blueprint sync (Render > Blueprint > Sync); otherwise add them in the site's *Headers* settings.
2. If the backend or Supabase URL differs from `render.yaml`, update the CSP `connect-src` before deploying.
3. Backend env: `CORS_ORIGINS` is the exact site URL (not `*`), `TRUST_PROXY=1`, `SUPABASE_URL` and
   `SUPABASE_SERVICE_KEY` set. Optional `SUPABASE_PUBLISHABLE_KEY`. Do not set `API_DOCS` or leave `RATE_LIMIT_OFF` on.
4. Run the hardening block at the end of `backend/supabase.sql` in the Supabase SQL editor.
5. In Supabase Auth: site URL and redirect URLs list only `https://clearscript-hacknex.onrender.com`.
6. Open the site, check the browser console for CSP errors, sign in, upload a Docs file, and confirm a second browser
   cannot see it. `curl -I` the site and `/api/health` to see the headers.
7. Fill the placeholders in `frontend/src/i18n/en/legal.ts` (contact, operator, jurisdiction, retention) and have the
   privacy policy and terms reviewed by a lawyer before a public launch.

## Running the checks

```bash
cd backend && .venv/Scripts/python -m pytest          # 92 tests, offline (Windows path; .venv/bin on macOS/Linux)
.venv/Scripts/pip-audit -r requirements.txt
cd ../frontend && npm audit && npm run build
```
