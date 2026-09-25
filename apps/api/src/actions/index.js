// Side-effect-only module: requiring it registers every action handler.
// Import this once at boot (src/app.js) before any chat request can arrive.
// Adding a new action for a new domain is: write the file, require it here.
require('./checkBillStatus');
