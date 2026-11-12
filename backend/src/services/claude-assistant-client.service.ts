import type Anthropic from '@anthropic-ai/sdk';

import type {
  AssistantModelReply, IAssistantClient,
} from '../interfaces/assistant-client.interface.js';
import { ASSISTANT_SYSTEM_PROMPT } from '../prompts/assistant.prompt.js';
import type { MessageParam } from '../types/assistant.types.js';
import { ASSISTANT_TOOLS } from '../utils/assistant-tools.util.js';

/**
 * The real assistant client: one Messages API call per model turn.
 *
 * - **Caching.** Tools and the frozen system prompt are the same bytes on every
 *   request, so the system block carries a breakpoint; the top-level
 *   `cache_control` caches the growing conversation as well, so turn 4 reads
 *   turns 1-3 from the cache.
 * - **Effort** is set explicitly: `medium` is this model's default, stated so a
 *   model change does not quietly change it.
 * - **Fallbacks** `default`: if the model declines for a policy reason, the API
 *   retries on its server-chosen fallback inside the same call.
 * - Non-streaming: a reply is a sentence or a tool call, and the app shows it
 *   whole.
 */
export class ClaudeAssistantClient implements IAssistantClient {
  constructor(
    private readonly client: Anthropic,
    private readonly model: string,
    private readonly healthModel: string,
  ) {}

  /**
   * One token from the small model, thinking off: it costs a fraction of a
   * cent and fails exactly when a real chat would — the key, the credit and
   * the API are all the same.
   */
  async ping(): Promise<void> {
    await this.client.messages.create({
      model: this.healthModel,
      max_tokens: 1,
      thinking: { type: 'disabled' },
      messages: [{ role: 'user', content: 'ping' }],
    });
  }

  async send(messages: MessageParam[]): Promise<AssistantModelReply> {
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' },
      system: [{ type: 'text', text: ASSISTANT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: ASSISTANT_TOOLS,
      messages,
    });

    const { usage } = response;
    console.log(`[assistant] in ${String(usage.input_tokens)}`
      + ` cached ${String(usage.cache_read_input_tokens ?? 0)}`
      + ` written ${String(usage.cache_creation_input_tokens ?? 0)}`
      + ` out ${String(usage.output_tokens)} stop ${response.stop_reason ?? 'none'}`);

    return { content: response.content, stopReason: response.stop_reason };
  }
}
