import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { ArrowDownToLine, X } from "lucide-react";
import { isTauri, openExternal } from "../lib/desktop";
import {
  checkForRelease, readUpdatePreference, writeUpdatePreference,
  RELEASE_CHECK_INTERVAL, RELEASE_DISMISSED_KEY, type ReleaseUpdate,
} from "../lib/releaseUpdates";

export function ReleaseNotice() {
  const [release, setRelease] = useState<ReleaseUpdate | null>(null);
  const [dismissed, setDismissed] = useState(() => readUpdatePreference(RELEASE_DISMISSED_KEY));
  const [openFailed, setOpenFailed] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let checking = false;
    const check = async () => {
      if (checking || document.visibilityState === "hidden") return;
      checking = true;
      try {
        const update = await checkForRelease(await getVersion());
        if (!disposed) setRelease(update);
      } catch { /* Version lookup failures must not interrupt note taking. */ }
      finally { checking = false; }
    };
    const refresh = () => { void check(); };
    const syncDismissal = (event: StorageEvent) => {
      if (event.key === RELEASE_DISMISSED_KEY || event.key === null) {
        setDismissed(readUpdatePreference(RELEASE_DISMISSED_KEY));
      }
    };
    const startup = window.setTimeout(refresh, 10_000);
    const interval = window.setInterval(refresh, RELEASE_CHECK_INTERVAL);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("storage", syncDismissal);
    return () => {
      disposed = true;
      window.clearTimeout(startup);
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("storage", syncDismissal);
    };
  }, []);

  if (!release || dismissed === release.version) return null;
  return (
    <div className="release-notice chrome-interactive" role="status">
      <button type="button" className="release-notice-link" title={`Tigrana ${release.version} is available. Open release notes and downloads.`}
        onClick={() => {
          setOpenFailed(false);
          void openExternal(release.url).catch(() => setOpenFailed(true));
        }}>
        <ArrowDownToLine size={14} />
        {openFailed ? "Retry opening update" : `Update ${release.version}`}
      </button>
      <button type="button" className="release-notice-dismiss" aria-label={`Dismiss update ${release.version}`} onClick={() => {
        writeUpdatePreference(RELEASE_DISMISSED_KEY, release.version);
        setDismissed(release.version);
      }}><X size={12} /></button>
    </div>
  );
}
