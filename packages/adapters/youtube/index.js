import { createNativeAdapter } from '../native-runtime.js';

// Text root: live static-proof evidence. Other roots/scope: synthetic candidates,
// not an assertion of current universal YouTube DOM support.
export const adapterKey = '__elmychatYouTubeAdapterV1';

export const installYouTubeAdapter = createNativeAdapter({
  platform: 'youtube', key: adapterKey,
  containerSelector: 'yt-live-chat-item-list-renderer #items',
  rootTypes: [
    { selector: 'yt-live-chat-text-message-renderer', kind: 'text' },
    { selector: 'yt-live-chat-paid-message-renderer', kind: 'paid-message' },
    { selector: 'yt-live-chat-paid-sticker-renderer', kind: 'paid-sticker' },
    { selector: 'yt-live-chat-membership-item-renderer', kind: 'membership' },
    { selector: 'yt-live-chat-sponsorships-gift-purchase-announcement-renderer', kind: 'gift-purchase' },
    { selector: 'yt-live-chat-sponsorships-gift-redemption-announcement-renderer', kind: 'gift-redemption' },
  ],
  identityAttributes: ['id', 'data-id'], selectorAttributes: ['id'],
});

export function youtubeAdapterExpression(options) {
  return `(${installYouTubeAdapter.toString()})(${JSON.stringify(options)})`;
}
