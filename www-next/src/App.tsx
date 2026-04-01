import { useState, useEffect, useRef, lazy, Suspense, Component, type ReactNode } from 'react';
import { useStatus } from './hooks/useStatus';
import { Header, type AppTab } from './components/Header';
import { UpdateBanner } from './components/UpdateBanner';
import { ConnectionBar } from './components/ConnectionBar';
import { GcsStatusCard } from './components/GcsStatusCard';
import { AircraftStatusCard } from './components/AircraftStatusCard';
import { BridgeControls } from './components/BridgeControls';
import { CaptureControls } from './components/CaptureControls';
import { FileManager } from './components/FileManager';

// Recharts has an internal react-redux subscription bug that can cause
// infinite render loops (React #185). This boundary contains the crash
// and auto-recovers on the next status poll cycle.
class ChartBoundary extends Component<
  { children: ReactNode; resetKey: unknown },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidUpdate(prev: { resetKey: unknown }) {
    if (this.state.hasError && prev.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }
  render() {
    if (this.state.hasError) return (
      <div className="bg-bg-card border border-border rounded-xl p-8 text-center text-sm text-text-secondary">
        Charts recovering...
      </div>
    );
    return this.props.children;
  }
}

// Lazy load heavy components
const NetworkStats = lazy(() => import('./components/NetworkStats').then(m => ({ default: m.NetworkStats })));
const LogViewer = lazy(() => import('./components/LogViewer').then(m => ({ default: m.LogViewer })));
const BindingManager = lazy(() => import('./components/BindingManager').then(m => ({ default: m.BindingManager })));
const HelpPage = lazy(() => import('./components/HelpPage').then(m => ({ default: m.HelpPage })));
const OutagePanel = lazy(() => import('./components/OutagePanel').then(m => ({ default: m.OutagePanel })));
const UpdateModal = lazy(() => import('./components/UpdateModal').then(m => ({ default: m.UpdateModal })));

function Skeleton({ height = 'h-48' }: { height?: string }) {
  return (
    <div className={`${height} bg-bg-card border border-border rounded-xl animate-pulse`} />
  );
}

export default function App() {
  const { status, error, lastUpdate, refresh } = useStatus();
  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  // Latch: once we've seen update_available=true, keep showing banner
  // until user dismisses (X button) or post-update reload clears it
  const [updateSeen, setUpdateSeen] = useState<{ latest: string; branch: string } | null>(null);
  const updateSeenRef = useRef(updateSeen);
  updateSeenRef.current = updateSeen;
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [suppressBanner, setSuppressBanner] = useState(() => {
    try { return sessionStorage.getItem('update-just-applied') === '1'; } catch { return false; }
  });

  useEffect(() => {
    if (!status) return;
    const v = status.version;
    if (v.update_available && v.latest) {
      setUpdateSeen({ latest: v.latest, branch: v.branch || 'main' });
    } else if (updateSeenRef.current && !v.update_available && v.latest) {
      setUpdateSeen(null);
    }
  }, [status]);

  // Clear post-update suppression once status confirms no update pending
  useEffect(() => {
    if (suppressBanner && status && !status.version.update_available) {
      setSuppressBanner(false);
      setUpdateSeen(null);
      try { sessionStorage.removeItem('update-just-applied'); } catch {}
    }
  }, [suppressBanner, status]);

  return (
    <>
      <Header
        connected={status?.connection.established ?? false}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        version={status?.version}
      />

      {updateSeen && !bannerDismissed && !suppressBanner && (
        <UpdateBanner
          current={status?.version.current ?? ''}
          latest={updateSeen.latest}
          branch={updateSeen.branch}
          onUpdate={() => setUpdateModalOpen(true)}
          onDismiss={() => setBannerDismissed(true)}
        />
      )}

      {status && (
        <Suspense fallback={null}>
          <UpdateModal
            open={updateModalOpen}
            onClose={() => setUpdateModalOpen(false)}
            status={status}
          />
        </Suspense>
      )}

      <main className="max-w-5xl mx-auto p-4 space-y-4">
        {error && !status && (
          <div className="bg-error/20 border border-error/30 rounded-xl px-4 py-3 text-sm text-error">
            Failed to connect to bridge: {error}
          </div>
        )}

        {activeTab === 'dashboard' && status && (
          <>
            <ConnectionBar status={status} lastUpdate={lastUpdate} />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <GcsStatusCard status={status} />
              <AircraftStatusCard status={status} />
            </div>

            <ChartBoundary resetKey={lastUpdate}>
              <Suspense fallback={<Skeleton height="h-80" />}>
                <NetworkStats status={status} />
              </Suspense>
            </ChartBoundary>

            <Suspense fallback={<Skeleton height="h-48" />}>
              <OutagePanel />
            </Suspense>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <BridgeControls status={status} onRefresh={refresh} />
              <CaptureControls status={status} onRefresh={refresh} />
            </div>

            <Suspense fallback={<Skeleton height="h-64" />}>
              <LogViewer />
            </Suspense>

            <FileManager />
          </>
        )}

        {activeTab === 'binding' && (
          <Suspense fallback={<Skeleton height="h-96" />}>
            <BindingManager onRefresh={refresh} />
          </Suspense>
        )}

        {activeTab === 'help' && (
          <Suspense fallback={<Skeleton height="h-96" />}>
            <HelpPage />
          </Suspense>
        )}

        {activeTab === 'dashboard' && !status && !error && (
          <div className="flex items-center justify-center h-64">
            <span className="w-8 h-8 border-3 border-accent/30 border-t-accent rounded-full animate-[spin_0.8s_linear_infinite]" />
          </div>
        )}
      </main>
    </>
  );
}
