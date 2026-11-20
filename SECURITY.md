# Security

Report vulnerabilities privately via GitHub Security Advisories on this repository.

## Controls
- Strict CSP (no inline script/style, no `unsafe-*`), `connect-src` limited to the two API origins; `_headers` adds `frame-ancestors 'none'`, nosniff, HSTS.
- No `innerHTML`/eval; all API strings rendered via `textContent`. External links: https + host allowlist, `noopener noreferrer`, no referrer.
- Requests: HTTPS, no credentials, no cache, redirects rejected, 12 s timeout covering the body, size limits, strict parsing. Malformed responses are errors, never "not found".
- Android: cleartext disabled (manifest + network security config), backups off, only `INTERNET` permission, only the launcher activity exported. `scripts/android_harden.py` fails the build otherwise, and CI re-checks the built APK's merged permissions.
- CI: read-only token, no persisted credentials, install scripts disabled, `npm audit`.

## Issues found in the imported v0.3 and fixed
1. CI used Java 17; Capacitor 7 requires JDK 21 (build would fail).
2. Manifest hardening was a string-replace that never set `allowBackup` and was unverified.
3. Email address was sent to a third party without explicit consent.
4. Undocumented `?details=false` parameter and an unsourced rate-limit figure.
5. Empty/malformed API replies could be read as "not found".
6. PWA lacked PNG icons, offline page, and a safe cache allowlist; no English UI.
7. Clickjacking was not addressable via meta CSP (header file + JS framebust added).

## Testing actually performed (local sandbox)
- 53 Node tests + 15 Python tests (unit, parsing, errors/timeouts, XSS via fake DOM, URL handling, CSP/PWA config, i18n), plus mutation checks showing 12/12 deliberate breakages were caught.
- Custom static lint (not ESLint) and secret-pattern scan.

## Not performed
- **No penetration test and no dynamic testing** (no browser, device, or emulator available). `app.js` is not executed by any test.
- Not verified: browser CORS to both APIs, XposedOrNot's live response beyond its public docs, WebView behaviour, back-button behaviour, splash rendering, the APK build itself.
- Memory of typed passwords cannot be zeroized.
- No claim is made that the app is free of vulnerabilities.
