// Single centralized keydown listener, gated by current screen state.
//
// This exists specifically to avoid the known OG-GDMS bug: the original Tkinter app
// bound hotkeys per-screen directly to the window and didn't unbind on screen change,
// so keys from a previous screen could still fire on the new one. Here there is
// exactly ONE addEventListener call, ever. Screens register a handler function under
// a name; only the handler for the CURRENT screen is ever invoked.

const handlers = new Map();
let currentScreen = null;

export function registerScreen(name, handler) {
  handlers.set(name, handler);
}

export function setScreen(name) {
  currentScreen = name;
}

export function getScreen() {
  return currentScreen;
}

document.addEventListener('keydown', (e) => {
  const handler = handlers.get(currentScreen);
  if (!handler) return;
  handler(e);
});
