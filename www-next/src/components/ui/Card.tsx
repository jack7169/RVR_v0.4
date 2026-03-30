interface CardProps {
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}

export function Card({ title, badge, children }: CardProps) {
  return (
    <div className="bg-bg-card rounded-xl border border-border overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="font-semibold text-sm">{title}</span>
        {badge}
      </div>
      <div className="p-4 space-y-2">
        {children}
      </div>
    </div>
  );
}

export function StatusRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-text-secondary">{label}</span>
      <span>{children}</span>
    </div>
  );
}
