import { useState, useEffect, useRef } from 'react';
import type { VersionInfo, CheckUpdateResponse } from './types';

/**
 * Manages update visibility state: latching, dismiss, post-update suppression.
 * Extracted from RVR App.tsx to share between projects.
 */
export function useUpdateState(version?: VersionInfo) {
  // Latch: once we've seen update_available=true, keep showing banner
  // until user dismisses or post-update reload clears it
  const [updateSeen, setUpdateSeen] = useState<{ latest: string; branch: string } | null>(null);
  const updateSeenRef = useRef(updateSeen);
  updateSeenRef.current = updateSeen;

  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [suppressBanner, setSuppressBanner] = useState(() => {
    try { return sessionStorage.getItem('update-just-applied') === '1'; } catch { return false; }
  });

  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [updateTarget, setUpdateTarget] = useState('default');

  // Latch update_available state
  useEffect(() => {
    if (!version) return;
    if (version.update_available && version.latest) {
      setUpdateSeen({ latest: version.latest, branch: version.branch || 'main' });
    } else if (updateSeenRef.current && !version.update_available && version.latest) {
      setUpdateSeen(null);
    }
  }, [version]);

  // Clear post-update suppression on first status poll
  useEffect(() => {
    if (!suppressBanner || !version) return;
    setSuppressBanner(false);
    try { sessionStorage.removeItem('update-just-applied'); } catch {}
    if (!version.update_available) {
      setUpdateSeen(null);
    }
  }, [suppressBanner, version]);

  const handleCheckResult = (r: CheckUpdateResponse) => {
    if (r.update_available && r.latest) {
      setUpdateSeen({ latest: r.latest, branch: r.branch || 'main' });
      setBannerDismissed(false);
    } else {
      setUpdateSeen(null);
    }
  };

  const showBanner = updateSeen !== null && !bannerDismissed && !suppressBanner;

  return {
    updateSeen,
    showBanner,
    bannerDismissed,
    dismissBanner: () => setBannerDismissed(true),
    suppressBanner,
    handleCheckResult,
    updateModalOpen,
    setUpdateModalOpen,
    updateTarget,
    setUpdateTarget,
  };
}
