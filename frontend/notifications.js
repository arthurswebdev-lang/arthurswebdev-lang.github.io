/* ---------------------------------------------------------------------------
   Push notifications.

   Firebase is the delivery wire and nothing else: this file's whole job is to
   obtain an FCM registration token for *this* install and hand it to the API,
   which already knows which events are due and for whom. There is no schedule
   here, and no copy of the task list.

   Two constraints shape everything below, both of them the subpath problem in
   disguise. Pages serves this app from https://<user>.github.io/<repo>/, so
   every path is relative and the service worker is registered by hand — left
   to itself the SDK looks for /firebase-messaging-sw.js at the origin root,
   where a project site has nothing.

   And iOS gives web push only to installed apps: in a Safari tab `Notification`
   does not exist at all, so the honest answer there is "Add to Home Screen
   first" rather than a button that cannot work.
--------------------------------------------------------------------------- */
import { registerDevice } from './api.js?v=11';

const SW_PATH = './firebase-messaging-sw.js';

let messaging = null;

/**
 * The credentials this install is already registered against, so the refresh
 * below is a no-op on the second call. `load()` runs on every filter tap and
 * none of those need a round-trip to Google; a different token — someone else
 * signing in on this device — does.
 */
let registeredFor = null;

const isApple = () => /iP(hone|ad|od)/.test(navigator.userAgent);

/** True once the app has been added to the home screen and opened from there. */
const isInstalled = () => window.matchMedia('(display-mode: standalone)').matches
  || navigator.standalone === true;

const hasSdk = () => typeof globalThis.firebase !== 'undefined'
  && globalThis.FIREBASE_CONFIG !== undefined;

/**
 * One of: `unsupported`, `needs-install`, `default`, `granted`, `denied`.
 *
 * `needs-install` is the iOS case above — not a refusal, just not yet. It is
 * worth its own state because the fix is a step the user takes in Safari's
 * share sheet, which no button in here can do for them.
 */
export function notificationState() {
  if (!('serviceWorker' in navigator) || !hasSdk()) return 'unsupported';
  if (!('Notification' in window)) return isApple() && !isInstalled() ? 'needs-install' : 'unsupported';

  return Notification.permission;
}

function initMessaging() {
  if (messaging === null) {
    // initializeApp throws on a second call, and this module is reachable from
    // both the menu and the launch path.
    if (globalThis.firebase.apps.length === 0) {
      globalThis.firebase.initializeApp(globalThis.FIREBASE_CONFIG);
    }
    messaging = globalThis.firebase.messaging();

    // Firebase shows the notification itself only when the page is in the
    // background (see firebase-messaging-sw.js). In the foreground it hands
    // the payload over and shows nothing, so this is where the app is open and
    // an event has just come due — the one place showNotification is correct.
    messaging.onMessage((payload) => { void showForeground(payload); });
  }

  return messaging;
}

async function showForeground({ notification }) {
  if (notification === undefined || Notification.permission !== 'granted') return;

  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification(notification.title, {
    body: notification.body,
    icon: './icons/icon-192.png',
  });
}

/**
 * The worker Firebase pushes through, registered explicitly with a relative
 * scope so it lands under the project subpath rather than the origin root.
 */
async function pushWorker() {
  const registration = await navigator.serviceWorker.register(SW_PATH, { scope: './' });
  await navigator.serviceWorker.ready;

  return registration;
}

/**
 * Asks Firebase for this install's token and tells the API about it.
 *
 * Passing the registration is what makes it work under a subpath; without it
 * the SDK goes looking at the origin root and fails with a service-worker
 * error that reads like a permissions problem but is not one.
 */
async function registerToken(authToken) {
  const registration = await pushWorker();
  const fcmToken = await initMessaging().getToken({
    vapidKey: globalThis.FCM_VAPID_KEY,
    serviceWorkerRegistration: registration,
  });

  if (!fcmToken) throw new Error('Firebase issued no token for this device');

  await registerDevice(authToken, fcmToken);

  return fcmToken;
}

/**
 * Turns notifications on. Must be called from a user gesture — iOS refuses the
 * permission prompt otherwise, silently.
 *
 * Returns the resulting state, so the caller can say what happened rather than
 * assuming it worked.
 */
export async function enableNotifications(authToken) {
  const state = notificationState();
  if (state !== 'default' && state !== 'granted') return state;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission;

  await registerToken(authToken);
  registeredFor = authToken;

  return 'granted';
}

/**
 * Re-registers on launch, when permission is already granted.
 *
 * Not optional housekeeping: FCM rotates tokens, and a stale one means the
 * pushes stop arriving with nothing on screen to say so. Failure here is never
 * worth interrupting the app for — the user did not ask for this.
 */
export async function refreshRegistration(authToken) {
  if (registeredFor === authToken || notificationState() !== 'granted') return;

  // Claimed before the await, so two loads in flight together do not both ask.
  registeredFor = authToken;

  try {
    await registerToken(authToken);
  } catch (error) {
    // Let the next load try again rather than going quiet until a reload.
    registeredFor = null;
    console.error('[push] could not refresh this device’s registration', error);
  }
}
