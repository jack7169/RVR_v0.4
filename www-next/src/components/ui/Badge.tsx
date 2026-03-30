import { cn } from '../../lib/utils';

const variants = {
  success: 'bg-success/20 text-success border-success/30',
  error: 'bg-error/20 text-error border-error/30',
  warning: 'bg-warning/20 text-warning border-warning/30',
  info: 'bg-accent/20 text-accent border-accent/30',
  neutral: 'bg-border/30 text-text-secondary border-border',
} as const;

interface BadgeProps {
  variant: keyof typeof variants;
  children: React.ReactNode;
}

export function Badge({ variant, children }: BadgeProps) {
  return (
    <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full border', variants[variant])}>
      {children}
    </span>
  );
}
