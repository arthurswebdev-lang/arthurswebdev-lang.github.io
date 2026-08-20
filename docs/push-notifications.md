# Push notifications

Real notifications that arrive when the app is closed, for `EVENT` tasks that
have just come due.

Firebase is the **delivery wire and nothing else**: no Firestore, no Cloud
Functions, no Cloud Scheduler. Deciding what is due stays in
`EventPollingService`, against our own Mongo, so the schedule is not tied to a
Google Cloud billing account.

## Shape

```
  browser / installed PWA                    fly.io (this API)
  ───────────────────────                    ─────────────────
  Notification.requestPermission()
  getToken(vapidKey, swRegistration)
            │
            │  POST /devices { token }        devices collection
            └──────────────────────────────►  one row per install,
                                              unique on token
                                                     │
                                              EventPollingService
                                              every POLL_INTERVAL_MS:
                                              "what came due since
                                               the last pass?"
                                                     │
                                              FcmNotificationService
                                                     │
                                              messaging.send() ──► FCM ──► device
```

The client never syncs its tasks. The server already owns them and already has
`userId` on every event, so the only thing the browser has to contribute is the
address to push to.

Files: `frontend/notifications.js`, `frontend/firebase-messaging-sw.js`,
`src/services/fcm-notification.service.ts`, `src/storage/fcm.storage.ts`,
`src/repositories/devices.repository.ts`.

## What has to be true in production

| Thing | Where | Why |
| --- | --- | --- |
| `FIREBASE_SERVICE_ACCOUNT` | fly secret | Without it the API falls back to `ConsoleNotificationService` and logs instead of sending. |
| `APP_URL` | fly secret | Optional. Where a tapped notification opens; without it the alert is not clickable through to the app. |
| `min_machines_running = 1` | `fly.toml` | **Not optional.** See below. |
| Firebase project matches | `frontend/firebase-config.js` | The service account and the web config must be the *same* project or every send fails on a credential mismatch. |
| Pages source = GitHub Actions | repo settings | One-time. `.github/workflows/pages.yml` publishes `frontend/`. |

### The machine may not sleep

`auto_stop_machines` was `'stop'` with `min_machines_running = 0`. That is right
for a pure request/response API and wrong the moment notifications exist:
the poller is a `setInterval` inside the process, not a reaction to an incoming
request, so a machine stopped for want of HTTP traffic stops noticing that
anything is due.

It is worse than a delay. `EventPollingService` keeps its "what have I already
announced" window **in memory**, so a restart resets it and events that came due
while the machine was down are never announced at all — not even late.

## Deploying

**Backend** — from `backend/`:

```bash
# The key is the service-account JSON from the Firebase console
# (Project settings > Service accounts > Generate new private key).
# base64 because fly secrets are single-line; the API accepts either form.
fly secrets set FIREBASE_SERVICE_ACCOUNT="$(base64 -i service-account.json)"
fly secrets set APP_URL="https://arthurswebdev-lang.github.io/daily-habits/"

fly deploy
fly logs   # expect: push: firebase cloud messaging
```

Setting a secret restarts the machine on its own, so the first `fly deploy`
after them is only needed for the code.

`ORIGIN` is already `*`, which is deliberate — credentials travel in the
Authorization header rather than a cookie, so a permissive origin exposes
nothing a browser would attach by itself (see `cors.middleware.ts`).

**Frontend** — Pages publishes on any push to `main` touching `frontend/**`:

```bash
git push origin main
```

One-time first: repo **Settings > Pages > Source = GitHub Actions**. Until that
is set the workflow runs and the site stays 404.

`frontend/index.html` already points `API_BASE` at
`https://artur-todo-list-api.fly.dev`.

## Testing

**Desktop browser** — the quick loop. Open the Pages URL in Chrome, sign in,
menu (⌄) → *Turn on notifications*, allow. Add an event a couple of minutes out.
It fires within `POLL_INTERVAL_MS` of the due time (60s by default).

This exercises the entire chain for real: token issuance, `POST /devices`, the
poller, `messaging.send()`, Google's infrastructure, delivery.

**iPhone** — the part desktop cannot cover. iOS gives web push *only* to
home-screen apps:

1. Open the Pages URL in **Safari** (not Chrome — on iOS only Safari can install).
2. Share → **Add to Home Screen**.
3. Open the app **from the home screen icon**, not from Safari.
4. Menu (⌄) → *Turn on notifications*. The prompt only appears from that tap;
   iOS refuses a permission request that is not tied to a user gesture.

If the menu item reads *Add to Home Screen first*, step 3 has not happened —
in a Safari tab `window.Notification` does not exist at all.

Requires iOS 16.4 or later.

## When nothing arrives

- `fly logs` says `push: not configured` → the secret is missing or empty.
- Sends fail with a credential error → the service account and
  `frontend/firebase-config.js` are different Firebase projects.
- Nothing fires but the app works → check the machine is actually up
  (`fly status`); see "may not sleep" above.
- A token that FCM reports as dead is deleted from `devices` automatically, so
  the next registration from that browser starts clean. Reinstalling the PWA
  issues a *new* token; the old row lingers until its next send fails.
- The alert arrives twice → something is calling `showNotification` inside
  `onBackgroundMessage`. Firebase already displays background messages itself;
  only the *foreground* path (`onMessage`) should show one.
