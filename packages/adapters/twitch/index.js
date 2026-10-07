import { createNativeAdapter } from '../native-runtime.js';

// The text selector has operator evidence; data-id remains a synthetic heuristic.
export const adapterKey = '__elmychatTwitchAdapterV1';

export const installTwitchAdapter = createNativeAdapter({
  platform: 'twitch', key: adapterKey, containerSelector: null,
  rootTypes: [{ selector: '[data-a-target="chat-line-message"]', kind: 'text' }],
  identityAttributes: ['data-id'], selectorAttributes: ['data-a-target'],
  // Match the conventional Twitch sidebar width instead of stretching text
  // across a wide OBS source. Typography/whitespace remain owned by Twitch.
  messageWidthLimit: 340,
});

export function twitchAdapterExpression(options) {
  return `(${installTwitchAdapter.toString()})(${JSON.stringify(options)})`;
}
