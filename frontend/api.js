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

/**
 * The reason the server gave, or the status if it did not give one.
 *
 * The API answers a rejected write with `{ status, message, code }`, and that
 * message is the only thing that says *why*. Throwing "Request failed (400)"
 * instead turned a precise complaint into a shrug.
 */
async function failure(response, fallback) {
  const problem = await response.json().catch(() => null);

  return new Error(problem?.message ?? `${fallback} (${String(response.status)})`);
}

async function get(path, token) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Basic ${token}` },
  });

  if (response.status === 401) throw new Error("UNAUTHORIZED");
  if (!response.ok) throw await failure(response, "Request failed");

  return response.json();
}

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

/* --- writes --------------------------------------------------------------- */

async function send(method, path, token, body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (response.status === 401) throw new Error("UNAUTHORIZED");
  if (!response.ok) throw await failure(response, "Request failed");

  return response.status === 204 ? null : response.json();
}

/** Signup is the one call that carries no credentials — it creates them. */
export async function signUp(username, password) {
  const response = await fetch(`${API_BASE}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (response.status === 409) throw new Error("TAKEN");
  if (!response.ok) throw await failure(response, "Sign up failed");

  return response.json();
}

/**
 * Hands this install's FCM token to the API, so the server knows where to push
 * when one of this user's events comes due. Safe to repeat — the API keys on
 * the token, so re-registering the same browser updates rather than duplicates.
 */
export const registerDevice = (token, fcmToken) =>
  send("POST", "/devices", token, { token: fcmToken });

/**
 * Pushes a test to every install registered for this user, right now. Answers
 * with how many it reached, so "nothing arrived" can be told apart from
 * "nothing was registered".
 */
export const sendTestNotification = (token) => send("POST", "/devices/test", token);

export const createTask = (token, payload) => send("POST", "/tasks", token, payload);

/** PUT replaces the task outright — the payload is its whole new state. */
export const replaceTask = (token, id, payload) => send("PUT", `/tasks/${id}`, token, payload);

export const createRepeatedTask = (token, payload) =>
  send("POST", "/repeated-tasks", token, payload);

export const deleteRepeatedTask = (token, id) => send("DELETE", `/repeated-tasks/${id}`, token);

export const fetchRepeatedTask = (token, id) => get(`/repeated-tasks/${id}`, token);

export const replaceRepeatedTask = (token, id, payload) =>
  send("PUT", `/repeated-tasks/${id}`, token, payload);

export const setTaskStatus = (token, id, status) =>
  send("PATCH", `/tasks/${id}/status`, token, { status });

export const setStepStatus = (token, taskId, stepId, status) =>
  send("PATCH", `/tasks/${taskId}/subtasks/${stepId}/status`, token, { status });

export const deleteTask = (token, id) => send("DELETE", `/tasks/${id}`, token);

/**
 * Removes exactly these tasks, leaving any repeat behind them alone — unlike
 * deleteTask, which takes the whole rule when given one of its events.
 */
export const clearTasks = (token, ids) => send("POST", "/tasks/clear", token, { ids });
