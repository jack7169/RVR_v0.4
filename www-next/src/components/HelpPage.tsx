import { useState } from 'react';
import { Card } from './ui/Card';
import { cn } from '../lib/utils';

type Section = 'quickstart' | 'tuning' | 'troubleshooting';

const sections: { id: Section; label: string }[] = [
  { id: 'quickstart', label: 'Quick Start' },
  { id: 'tuning', label: 'Link Tuning' },
  { id: 'troubleshooting', label: 'Troubleshooting' },
];

function QuickStart() {
  return (
    <Card title="Quick Start Guide">
      <div className="space-y-4 text-sm text-text-secondary leading-relaxed">
        <div>
          <h4 className="font-medium text-text-primary mb-1">1. Install on Both Devices</h4>
          <p>Run the installer on both the GCS (Ground Control Station) and Aircraft routers. Each device needs to be on the same VPN network (Tailscale, Headscale, or WireGuard).</p>
          <pre className="bg-bg-primary rounded-lg p-3 mt-2 text-xs font-mono overflow-x-auto">
{`# GCS router:
sh install.sh --role gcs

# Aircraft router:
sh install.sh --role aircraft`}
          </pre>
          <p className="mt-2">The installer downloads RVR, installs packages (kcptun, tap2tcp), sets up the web UI, and enables the discovery endpoint.</p>
        </div>

        <div>
          <h4 className="font-medium text-text-primary mb-1">2. Bind an Aircraft</h4>
          <p>Open the GCS web UI and go to the <strong>Binding</strong> tab. Your aircraft should appear in Network Discovery if both devices are on the same VPN.</p>
          <ol className="list-decimal list-inside space-y-1 mt-2">
            <li>Find the aircraft in the peer list (filter to "Online" peers)</li>
            <li>Click <strong>Bind</strong></li>
            <li>Enter a name for the aircraft</li>
            <li>If SSH keys aren't set up, you'll be prompted for the root password</li>
            <li>Setup runs automatically — installs packages on the aircraft, configures the bridge, starts services</li>
          </ol>
          <p className="mt-2">Setup takes about 1-2 minutes. The log output streams in real-time in the bind modal.</p>
        </div>

        <div>
          <h4 className="font-medium text-text-primary mb-1">3. Verify the Bridge</h4>
          <p>After binding completes, check the <strong>Dashboard</strong> tab:</p>
          <ul className="list-disc list-inside space-y-1 mt-2">
            <li><strong>GCS Status</strong>: KCPtun Server and Tap2TCP should be "running"</li>
            <li><strong>Aircraft Status</strong>: Should show "Reachable" with services running</li>
            <li><strong>Connection</strong>: Should show "Connected" with a duration timer</li>
            <li><strong>Streams</strong>: Active streams increase as devices communicate across the bridge</li>
          </ul>
        </div>

        <div>
          <h4 className="font-medium text-text-primary mb-1">4. Switching Aircraft</h4>
          <p>To switch to a different aircraft, go to <strong>Binding</strong> and either:</p>
          <ul className="list-disc list-inside space-y-1 mt-2">
            <li>Click <strong>Bind</strong> on a new peer (runs full setup)</li>
            <li>Click <strong>Connect</strong> on an already-bound aircraft (reconnects without reinstalling)</li>
            <li>Use the aircraft dropdown in the header to switch the active profile</li>
          </ul>
        </div>
      </div>
    </Card>
  );
}

function LinkTuning() {
  return (
    <Card title="Link Tuning Reference">
      <div className="space-y-4 text-sm text-text-secondary leading-relaxed">
        <p>KCPtun uses the KCP protocol for reliable data transport over UDP. These settings control retransmission behavior, buffering, and throughput. The defaults are tuned for Starlink satellite links.</p>

        <div>
          <h4 className="font-medium text-text-primary mb-1">ARQ (Automatic Repeat Request)</h4>
          <p>Controls how the protocol detects and recovers from packet loss.</p>
          <table className="w-full mt-2 text-xs">
            <thead><tr className="border-b border-border">
              <th className="text-left py-1 pr-2 font-medium text-text-primary">Parameter</th>
              <th className="text-left py-1 pr-2 font-medium text-text-primary">Effect</th>
              <th className="text-left py-1 font-medium text-text-primary">Starlink Default</th>
            </tr></thead>
            <tbody>
              <tr className="border-b border-border/50"><td className="py-1.5 pr-2">No Delay</td><td className="py-1.5 pr-2">1=immediate ACKs (lower latency)</td><td className="py-1.5">1</td></tr>
              <tr className="border-b border-border/50"><td className="py-1.5 pr-2">Interval</td><td className="py-1.5 pr-2">Protocol tick rate. 10ms=responsive, 50ms=less CPU</td><td className="py-1.5">20ms</td></tr>
              <tr className="border-b border-border/50"><td className="py-1.5 pr-2">Resend</td><td className="py-1.5 pr-2">Fast retransmit after N skipped ACKs</td><td className="py-1.5">4 (~80ms)</td></tr>
              <tr><td className="py-1.5 pr-2">No Congestion</td><td className="py-1.5 pr-2">1=no throttling (dedicated link)</td><td className="py-1.5">1</td></tr>
            </tbody>
          </table>
        </div>

        <div>
          <h4 className="font-medium text-text-primary mb-1">Why Resend=4 for Starlink?</h4>
          <p>Starlink experiences periodic 100-500ms signal drops when switching between satellites. During these drops, all packets are lost. With resend=4 at interval=20ms, KCP waits ~80ms before retransmitting — long enough to ride out most brief drops without flooding retransmits into a dead link. When the link recovers, it immediately returns to full throughput.</p>
        </div>

        <div>
          <h4 className="font-medium text-text-primary mb-1">Buffering</h4>
          <table className="w-full mt-2 text-xs">
            <thead><tr className="border-b border-border">
              <th className="text-left py-1 pr-2 font-medium text-text-primary">Buffer</th>
              <th className="text-left py-1 pr-2 font-medium text-text-primary">Purpose</th>
              <th className="text-left py-1 font-medium text-text-primary">Default</th>
            </tr></thead>
            <tbody>
              <tr className="border-b border-border/50"><td className="py-1.5 pr-2">Socket Buffer</td><td className="py-1.5 pr-2">Kernel TCP buffer for kcptun connections</td><td className="py-1.5">8 MB</td></tr>
              <tr className="border-b border-border/50"><td className="py-1.5 pr-2">Smux Buffer</td><td className="py-1.5 pr-2">Total buffer shared across all streams</td><td className="py-1.5">8 MB</td></tr>
              <tr className="border-b border-border/50"><td className="py-1.5 pr-2">Stream Buffer</td><td className="py-1.5 pr-2">Per-stream buffer (each device pair direction)</td><td className="py-1.5">2 MB</td></tr>
              <tr><td className="py-1.5 pr-2">Send/Recv Window</td><td className="py-1.5 pr-2">Max packets in flight (throughput limiter)</td><td className="py-1.5">1024 pkts</td></tr>
            </tbody>
          </table>
        </div>

        <div>
          <h4 className="font-medium text-text-primary mb-1">When to Adjust</h4>
          <ul className="list-disc list-inside space-y-1">
            <li><strong>High packet loss</strong>: Lower resend threshold (2-3), decrease interval (10ms)</li>
            <li><strong>High latency (&gt;200ms)</strong>: Increase send/recv window (2048+), increase buffers</li>
            <li><strong>Low bandwidth</strong>: Decrease windows (256-512), decrease buffers to save RAM</li>
            <li><strong>Video stuttering</strong>: Increase stream buffer (4MB+) to absorb I-frame bursts</li>
          </ul>
        </div>
      </div>
    </Card>
  );
}

function Troubleshooting() {
  return (
    <Card title="Troubleshooting">
      <div className="space-y-4 text-sm text-text-secondary leading-relaxed">
        <div>
          <h4 className="font-medium text-error mb-1">Bridge not forwarding traffic</h4>
          <ul className="list-disc list-inside space-y-1">
            <li>Check that Tap2TCP and KCPtun are both "running" on both sides</li>
            <li>Check "RVR Interface" is "up" — if "down", the TAP device wasn't created</li>
            <li>STP convergence may still be in progress — wait up to 45 seconds after setup</li>
            <li>Check firewall: nftables bridge filter should be active. If "Inactive", re-run setup</li>
            <li>Verify both devices can ping each other via VPN IP</li>
          </ul>
        </div>

        <div>
          <h4 className="font-medium text-error mb-1">Streams stuck at 0</h4>
          <ul className="list-disc list-inside space-y-1">
            <li>No traffic is flowing across the bridge yet — streams are created on demand</li>
            <li>Try pinging a device on the aircraft's LAN from the GCS side</li>
            <li>Check that kcptun is connected: if KCPtun shows "running" but streams are 0, the KCP tunnel may not have established yet</li>
            <li>Check aircraft reachability — if the aircraft went offline, streams will close after 300s idle timeout</li>
          </ul>
        </div>

        <div>
          <h4 className="font-medium text-error mb-1">Aircraft shows "unreachable"</h4>
          <ul className="list-disc list-inside space-y-1">
            <li>Verify the aircraft is powered on and connected to the internet</li>
            <li>Check the VPN connection: both devices must be on the same Tailscale/Headscale/WireGuard network</li>
            <li>Try pinging the aircraft's VPN IP from the GCS command line</li>
            <li>If the aircraft recently rebooted, services may still be starting (allow 60s for boot)</li>
          </ul>
        </div>

        <div>
          <h4 className="font-medium text-error mb-1">Bind fails with SSH error</h4>
          <ul className="list-disc list-inside space-y-1">
            <li>Enter the correct root password for the aircraft router</li>
            <li>Ensure the aircraft allows SSH access (Dropbear must be running)</li>
            <li>If password auth is disabled on the aircraft, manually install SSH keys first</li>
            <li>The GCS needs <code className="bg-bg-primary px-1 rounded">sshpass</code> package for password-based key installation</li>
          </ul>
        </div>

        <div>
          <h4 className="font-medium text-error mb-1">Health check: FAILED</h4>
          <ul className="list-disc list-inside space-y-1">
            <li>The watchdog runs every minute and auto-restarts services when issues are detected</li>
            <li>Check the watchdog log: <code className="bg-bg-primary px-1 rounded">cat /tmp/rvr-watchdog.log</code></li>
            <li>Common causes: VPN disconnected, kcptun crashed, interface deleted by another process</li>
            <li>Manual recovery: click Stop then Start in Bridge Controls</li>
          </ul>
        </div>

        <div>
          <h4 className="font-medium text-error mb-1">High latency or packet loss</h4>
          <ul className="list-disc list-inside space-y-1">
            <li>Check Starlink signal quality in the Starlink app</li>
            <li>Use Packet Capture to analyze traffic: look for retransmissions, duplicate ACKs</li>
            <li>Try adjusting KCP settings in Binding &gt; Link Settings: lower interval, lower resend threshold</li>
            <li>Check if the VPN is using a relay (indirect routing adds latency)</li>
          </ul>
        </div>
      </div>
    </Card>
  );
}

export function HelpPage() {
  const [section, setSection] = useState<Section>('quickstart');

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {sections.map(s => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            className={cn(
              'text-sm px-4 py-1.5 rounded-lg transition-colors',
              section === s.id
                ? 'bg-accent/20 text-accent border border-accent/30'
                : 'bg-border/20 text-text-secondary hover:text-text-primary',
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {section === 'quickstart' && <QuickStart />}
      {section === 'tuning' && <LinkTuning />}
      {section === 'troubleshooting' && <Troubleshooting />}
    </div>
  );
}
