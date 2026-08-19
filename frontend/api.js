/* ---------------------------------------------------------------------------
   Credentials and read-only API access.

   The username and password are kept in IndexedDB as the base64 string that
   goes straight into the Authorization header, so nothing has to re-encode
   them on every request. This is deliberately simple: a personal app, one
   user, https in front of it. Base64 is encoding, not encryption — anyone
   with the device can read it.
--------------------------------------------------------------------------- */

const DB_NAME = "tasks-auth";
const STORE = "credentials";
const KEY = "current";

/** Set once per deployment. Same-origin by default, so a local file needs it. */
const API_BASE = globalThis.API_BASE ?? "http://localhost:3000";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE); };
    request.onsuccess = () => { resolve(request.result); };
    request.onerror = () => { reject(new Error("Could not open the credentials store")); };
  });
}

function withStore(mode, run) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = run(tx.objectStore(STORE));
    request.onsuccess = () => { resolve(request.result); };
    request.onerror = () => { reject(new Error("Credentials store failed")); };
  }));
}

/** The stored credentials, or null when this device has not been set up. */
export function readCredentials() {
  return withStore("readonly", (store) => store.get(KEY));
}

export async function saveCredentials(username, password) {
  const token = btoa(`${username}:${password}`);
  await withStore("readwrite", (store) => store.put({ username, token }, KEY));

  return { username, token };
}

export function forgetCredentials() {
  return withStore("readwrite", (store) => store.delete(KEY));
}

/* --- reads ---------------------------------------------------------------- */

async function get(path, token) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Basic ${token}` },
  });

  if (response.status === 401) throw new Error("UNAUTHORIZED");
  if (!response.ok) throw new Error(`Request failed (${String(response.status)})`);

  return response.json();
}

/** Confirms the stored credentials still work. */
export const fetchMe = (token) => get("/me", token);

/**
 * Tasks, optionally narrowed. The server applies both filters, so the client
 * does not repeat the rules — it just asks.
 */
export function fetchTasks(token, { filter, category } = {}) {
  const query = new URLSearchParams();
  if (filter) query.set("filter", filter);
  if (category && category !== "all") query.set("category", category);

  const suffix = query.toString();

  return get(`/tasks${suffix ? `?${suffix}` : ""}`, token);
}

export const fetchRepeatedTasks = (token) => get("/repeated-tasks", token);
