import Anthropic from '@anthropic-ai/sdk';

/**
 * The Claude API client, or `null` when no key is configured — the same shape
 * as `createMessaging` for Firebase. Null is a supported state: local
 * development and the test suite have no key, and the rest of the API must keep
 * working without one. The container turns null into "assistant not
 * configured", which the routes answer with a 503.
 */
export function createClaude(apiKey: string | undefined): Anthropic | null {
  if (apiKey === undefined || apiKey.trim() === '') return null;

  return new Anthropic({ apiKey });
}
