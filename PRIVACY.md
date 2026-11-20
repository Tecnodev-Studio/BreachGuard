# Privacy

BreachGuard has no account system, backend, analytics, or advertising. Results and history are not saved.

| Action | Sent | To |
|---|---|---|
| Password check | First 5 hex chars of SHA-1(password) | api.pwnedpasswords.com |
| Email check (after consent) | The full email address | api.xposedornot.com |
| Opening a source link | Nothing from the app (you navigate to the site) | the site |

- The password and the full hash never leave the device. k-anonymity reduces exposure; it is not anonymity.
- Providers and your network can see your IP address. Requests send no cookies or referrer.
- The password field is cleared after each check, when the tab is hidden, and when you leave the Password view. JavaScript cannot guarantee memory zeroization.
- Only the language choice (`bg.lang`) is kept in local storage.
- The service worker caches static app files only, never API traffic.
- Review each provider's own privacy policy and terms.
