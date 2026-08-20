/**
 * A browser or home-screen install that has asked to be notified.
 *
 * One row per FCM registration token, not per person: a user with a phone and
 * a laptop has two, and both should ring. The token is the whole address — FCM
 * needs nothing else to reach the install behind it.
 */
export interface Device {
  id: string;
  /** Owner. Set from the credentials, never from the payload. */
  userId: string;
  /** FCM registration token: opaque, issued by Google, rotates on its own. */
  token: string;
  createdAt: Date;
  /** Re-dated on every registration, which the client does on each launch. */
  updatedAt: Date;
}

/** What device registration accepts. The owner comes from the credentials. */
export interface RegisterDevice {
  token: string;
}
