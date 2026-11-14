// src/shims/splash-screen.js
// Electron shows the window only once the renderer has painted, so there
// is no native splash to dismiss. App.jsx still awaits hide() after the
// library finishes hydrating, and that await has to settle.
export const SplashScreen = {
  show: async () => {},
  hide: async () => {},
};

export default SplashScreen;
