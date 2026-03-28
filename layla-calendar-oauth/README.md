# layla-calendar-oauth

Minimal Google OAuth proxy for Layla Calendar on Cloudflare Workers.

## Endpoints

- `GET /oauth/google/start`
- `GET /oauth/google/callback`

`/oauth/google/start` redirects to Google and sets a short-lived OAuth state cookie.
`/oauth/google/callback` verifies state, exchanges code for access token, fetches Google Calendar events, and returns JSON.

## Google OAuth Client Type

Use **Web application** for this Worker-hosted OAuth server.

Why:
- Redirect URI is HTTPS on your Worker domain.
- Worker is acting as confidential backend and can safely keep `client_secret` in Cloudflare secret storage.

## Google Console Setup

Create OAuth client as **Web application**, then add:

- Authorized redirect URI:
  - `https://<your-worker-domain>/oauth/google/callback`

You do not need Authorized JavaScript origins for this server-only flow.

## Wrangler Setup

1. Update vars in [wrangler.jsonc](wrangler.jsonc):
- `GOOGLE_CLIENT_ID`
- `GOOGLE_REDIRECT_URI`

2. Set the secret:

```bash
wrangler secret put GOOGLE_CLIENT_SECRET
```

3. Deploy:

```bash
npm run deploy
```

## Local Dev

```bash
npm run dev
```

Then open:

- `http://127.0.0.1:8787/oauth/google/start`

For local callback testing, set `GOOGLE_REDIRECT_URI` to your local worker URL callback and add the same URI in Google Console redirect URIs.

## Notes

- This is intentionally simple and stateless.
- It returns fetched events directly after OAuth callback.
- For production app integration, consider adding a session layer and refresh token storage.
