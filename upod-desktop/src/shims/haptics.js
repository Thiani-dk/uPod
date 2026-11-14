// src/shims/haptics.js
// Laptops have no vibration motor. The click-wheel code already guards
// its calls with isNativePlatform() and catches failures, so resolving
// quietly is the whole job.
export const ImpactStyle = { Heavy: "HEAVY", Medium: "MEDIUM", Light: "LIGHT" };
export const NotificationType = { Success: "SUCCESS", Warning: "WARNING", Error: "ERROR" };

export const Haptics = {
  impact: async () => {},
  notification: async () => {},
  vibrate: async () => {},
  selectionStart: async () => {},
  selectionChanged: async () => {},
  selectionEnd: async () => {},
};

export default Haptics;
