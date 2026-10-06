# SecureVault frontend

React/Vite UI for the SecureVault API. See [the project README](../README.md) for setup, email enrollment, test funding, backups and deployment.

```powershell
npm ci
npm run dev
npm run lint
npm test
npm run build
npm run test:browser
```

Development proxies /api to port 5000. Access tokens and password-step challenges stay in memory. HttpOnly refresh cookies are managed by the server.

Registration requires an email verification link plus the password chosen when requesting it before displaying a real authenticator QR code. Resuming unfinished enrollment requires a fresh email link and rotates the setup secret. Production uses SMTP; local developers retrieve the link using the backend mailbox command. Recovery codes are displayed once after authenticator enrollment.

The transfer review confirms a recipient and retains one UUID across retries. Pending details and their key use user-scoped session storage before sending and survive navigation/reload. Only the opaque key uses persistent local storage for result recovery after a closed tab or browser restart. Passwords, tokens, authenticator codes and financial details never use persistent local storage. The authenticated result endpoint scopes results to the caller and masks recipient numbers. A missing result preserves the original key. Ref guards and Web Locks coordinate submissions across tabs. Recipient cooling off ends automatically. History filtering runs on the server, failed pages retry without skips, and sign-out propagates across tabs. The UI supports narrow screens and reduced motion.

Production should serve the built files through the supplied backend/proxy so browser security headers apply. Vite preview is for local inspection.
