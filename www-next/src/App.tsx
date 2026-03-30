import { useState, lazy, Suspense } from 'react';
import { useStatus } from './hooks/useStatus';
import { Header, type AppTab } from './components/Header';
import { ConnectionBar } from './components/ConnectionBar';
import { GcsStatusCard } from './components/GcsStatusCard';
import { AircraftStatusCard } from './components/AircraftStatusCard';
import { BridgeControls } from './components/BridgeControls';
import { CaptureControls } from './components/CaptureControls';
import { FileManager } from './components/FileManager';

// Lazy load heavy components
const NetworkStats = lazy(() => import('./components/NetworkStats').then(m => ({ default: m.NetworkStats })));
const LogViewer = lazy(() => import('./components/LogViewer').then(m => ({ default: m.LogViewer })));
const BindingManager = lazy(() => import('./components/BindingManager').then(m => ({ default: m.BindingManager })));
const HelpPage = lazy(() => import('./components/HelpPage').then(m => ({ default: m.HelpPage })));

function Skeleton({ height = 'h-48' }: { height?: string }) {
  return (
    <div className={`${height} bg-bg-card border border-border rounded-xl animate-pulse`} />
  );
}

export default function App() {
  const { status, error, lastUpdate, refresh } = useStatus();
  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');

  return (
    <>
      <Header
        connected={status?.connection.established ?? false}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onProfileChange={refresh}
      />

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

            <Suspense fallback={<Skeleton height="h-80" />}>
              <NetworkStats status={status} />
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
