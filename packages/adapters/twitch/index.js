import { createNativeAdapter } from '../native-runtime.js';
import { twitchMark } from '../platform-marks.js';
import { nativeMessageSelector, ffzMessageSelector } from './selectors.js';

// The text selector has operator evidence; data-id remains a synthetic heuristic.
export const adapterKey = '__elmychatTwitchAdapterV1';

export const installTwitchAdapter = createNativeAdapter({
  platform: 'twitch', key: adapterKey, containerSelector: null,
  rootTypes: [{ selector: nativeMessageSelector, kind: 'text' }, { selector: ffzMessageSelector, kind: 'text' }],
  identityAttributes: ['data-id'], selectorAttributes: ['data-a-target','data-room-id','data-extension'],
  // Match the conventional Twitch sidebar width instead of stretching text
  // across a wide OBS source. Typography/whitespace remain owned by Twitch.
  messageWidthLimit: 340,
  originMark: twitchMark,
});

export function twitchAdapterExpression(options) {
  return `(${installTwitchAdapter.toString()})(${JSON.stringify(options)})`;
}
