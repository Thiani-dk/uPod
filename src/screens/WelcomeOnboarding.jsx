// src/screens/WelcomeOnboarding.jsx
// Gates the whole app shell on a fresh install/reinstall until "All files
// access" is actually granted — see AllFilesAccessPlugin.java and
// ensureStoragePermission() in nativeFolder.js for why this is a real,
// separate permission uPod needs (not just the basic media permission).
// Deliberately has no persisted "have I seen this before" flag: the gate
// is purely the live permission check (see App.jsx), which is simpler and
// gets every case right for free — first-ever install, a reinstall
// (Android wipes the grant, so this reappears automatically with the note
// below already in view), and a dev's incremental `adb install -r` during
// active iteration (the grant survives that, so this never even mounts).
import React, { useEffect, useState } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { FolderLock } from "lucide-react";
import NoteMark from "../components/NoteMark";
import { AllFilesAccess } from "../utils/allFilesAccess";

export default function WelcomeOnboarding({ onGranted }) {
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    // There's no event Android fires when a special permission like this
    // is granted — resuming the app (the user coming back from the
    // Settings screen openSettings() opened) is the only real signal
    // available, so re-check every time that happens.
    let handle;
    CapacitorApp.addListener("resume", async () => {
      const { granted, applicable } = await AllFilesAccess.check();
      if (!applicable || granted) onGranted();
    }).then((h) => {
      handle = h;
    });
    return () => handle?.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function grantAccess() {
    setOpening(true);
    try {
      await AllFilesAccess.openSettings();
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="onboarding-screen">
      <div className="onboarding-mark">
        <NoteMark size={40} style={{ color: "#fff" }} />
      </div>
      <h1 className="onboarding-title">Welcome to uPod</h1>
      <p className="onboarding-body">
        uPod needs <strong>All files access</strong> to see your music folder — not just the basic media
        permission — so it can read your downloaded music files directly, however they're organized.
      </p>

      <button className="primary-btn onboarding-cta" onClick={grantAccess} disabled={opening}>
        <FolderLock size={15} />
        {opening ? "Opening Settings…" : "Grant All Files Access"}
      </button>

      <div className="onboarding-note">
        If you ever reinstall uPod, Android resets this permission automatically — you'll just need to
        grant it again here. It's normal, and only takes a second.
      </div>
    </div>
  );
}
