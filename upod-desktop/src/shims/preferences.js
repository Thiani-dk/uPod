// src/shims/preferences.js
// Stands in for @capacitor/preferences, backed by a JSON file in the
// Electron userData folder. Same string-in/string-out contract, including
// the null-for-missing that the app's `value ? ... : fallback` reads rely
// on.
import { native } from "./emitter";

export const Preferences = {
  get: ({ key }) => native().prefs.get({ key }),
  set: ({ key, value }) => native().prefs.set({ key, value }),
  remove: ({ key }) => native().prefs.remove({ key }),
  keys: () => native().prefs.keys(),
  clear: () => native().prefs.clear(),
};

export default Preferences;
