// Ordinary hosts only. FFZ's Twitch ChatLine renderer omits data-a-target
// and may remount the host; room/user attributes are not message identities.
export const nativeMessageSelector = '[data-a-target="chat-line-message"]';
export const ffzMessageSelector = 'div.chat-line__message[data-room-id]:not(.chat-line--inline):not([data-extension]):not(.ffz-notice-line)';
export const messageSelector = `${nativeMessageSelector},${ffzMessageSelector}`;
