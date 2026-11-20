# BreachGuard

Privacy-conscious breach exposure checker: responsive web app, installable PWA, and Android app (Capacitor). English and Arabic (RTL).

## What it does
- **Password check** – Have I Been Pwned *Pwned Passwords* range API. SHA-1 is computed on-device; only the first 5 hex characters are sent. The password and full hash are never sent.
- **Email check** – XposedOrNot free API, called only after you tick a consent box (the full address is sent to that provider).
- **Handoffs** – Have I Been Pwned (email search), Mozilla Monitor, Google Password Checkup are plain links you open yourself. They are never presented as checked.
- **Dashboard** (in-memory session status only), recommendations, and a security guide.

## What it does not do
- It is not a universal breach database. "Not found" means no match in that one provider only.
- No accounts, backend, analytics, history, or stored results.
- No private API keys exist anywhere. HIBP's email API needs a paid key, so it is not integrated.

## Quick start
```bash
npm install
npm run icons     # generates PNG icons (no dependencies)
npm test
npm run serve     # http://localhost:8080
```
Android: see [BUILD.md](BUILD.md). Security: [SECURITY.md](SECURITY.md). Privacy: [PRIVACY.md](PRIVACY.md).

## Status
Version 0.4.0. Not independently penetration-tested. See SECURITY.md for the exact testing performed and its limits. No license file has been chosen yet.
