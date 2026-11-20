# Contributing
- Run `npm run lint` and `npm test` before every PR.
- Never add scraped breach data, leaked credentials, or private API keys/keystores.
- Render untrusted strings with `textContent` only. `innerHTML` is blocked by the linter.
- External links must pass `safeExternalUrl` (https + allowlist). Adding a host needs justification and a CSP/test update.
- Keep negative results provider-scoped; never imply a universal all-clear.
- Keep English and Arabic dictionaries in sync (tests enforce this).
- Pin new dependencies to exact versions.
