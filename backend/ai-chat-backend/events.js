const { EventEmitter } = require("events");

// In-process event bus. Chat modules announce changes here; the realtime
// WebSocket server (huddle.js) pushes them to connected browsers.
//
// Events:
//   "general:message"  (message)                 new #general message
//   "general:changed"  ()                         members/roles/settings changed
//   "dm:message"       ({ members: [a, b], message })  new direct message

const bus = new EventEmitter();
bus.setMaxListeners(50);

module.exports = { bus };
