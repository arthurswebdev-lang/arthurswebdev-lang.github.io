import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ASSISTANT_TOOLS, MAX_STRICT_OPTIONAL_PARAMS } from '../../src/utils/assistant-tools.util.js';

interface SchemaNode {
  properties?: Record<string, SchemaNode>;
  required?: string[];
  items?: SchemaNode;
}

/** Optional properties in a schema, nested objects and array items included. */
function optionalParams(node: SchemaNode | undefined): number {
  if (node === undefined) return 0;

  const properties = Object.entries(node.properties ?? {});
  const required = new Set(node.required ?? []);
  const own = properties.filter(([name]) => !required.has(name)).length;
  const nested = properties.reduce((sum, [, child]) => sum + optionalParams(child), 0);

  return own + nested + optionalParams(node.items);
}

describe('assistant tools', () => {
  it('stay under the API\'s limit on optional parameters in strict tools', () => {
    // The API answers 400 above this limit — seen in production, where every chat failed.
    const total = ASSISTANT_TOOLS
      .filter((tool) => tool.strict === true)
      .reduce((sum, tool) => sum + optionalParams(tool.input_schema as SchemaNode), 0);

    assert.ok(total <= MAX_STRICT_OPTIONAL_PARAMS, `${String(total)} optional parameters in strict tools`);
  });

  it('keep the same order, so the prompt cache holds', () => {
    assert.deepEqual(ASSISTANT_TOOLS.map((tool) => tool.name), [
      'ask_user', 'find_tasks', 'find_repeats', 'propose_plan', 'create_task', 'create_repeated_task',
    ]);
  });
});
