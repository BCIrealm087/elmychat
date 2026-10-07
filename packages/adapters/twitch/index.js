import { createNativeAdapter } from '../native-runtime.js';

// The text selector has operator evidence; data-id remains a synthetic heuristic.
export const installTwitchAdapter = createNativeAdapter({
  platform: 'twitch', key: '__elmychatTwitchAdapterV1', containerSelector: null,
  rootTypes: [{ selector: '[data-a-target="chat-line-message"]', kind: 'text' }],
  identityAttributes: ['data-id'], selectorAttributes: ['data-a-target'],
});

export function twitchAdapterExpression(options) {
  return `(${installTwitchAdapter.toString()})(${JSON.stringify(options)})`;
}
