const { EventEmitter } = require("events");

// In-process event bus. Chat modules announce changes here; the realtime
// WebSocket server (huddle.js) pushes them to connected browsers.
//
// Events:
//   "general:message"  (message)                 new #general message
//   "general:changed"  ()                         members/roles/settings changed
//   "dm:message"       ({ members: [a, b], message })  new direct message
//   "general:messageUpdated" (message)          edited/deleted/reacted #general message
//   "dm:messageUpdated" ({ members: [a, b], message })  same for a direct message
//   "channel:message"  ({ channelId, message, audience })  new message in a channel
//   "channel:messageUpdated" ({ channelId, message, audience })
//   "channels:changed" ({ audience })  channel list/membership/topic changed
//   (audience: null = every signed-in member, else only these member ids)

const bus = new EventEmitter();
bus.setMaxListeners(50);

module.exports = { bus };
