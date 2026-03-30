import { cn } from '../../lib/utils';

const variants = {
  primary: 'bg-accent hover:bg-accent-hover text-white',
  success: 'bg-success hover:bg-success/80 text-white',
  danger: 'bg-error hover:bg-error/80 text-white',
  warning: 'bg-warning hover:bg-warning/80 text-black',
  ghost: 'bg-border/30 hover:bg-border/50 text-text-primary',
} as const;

const sizes = {
  sm: 'px-3 py-1 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-2.5 text-base',
} as const;

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  loading?: boolean;
}

export function Button({ variant = 'primary', size = 'md', loading, children, className, disabled, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'rounded-lg font-medium transition-all inline-flex items-center justify-center gap-2',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-[spin_0.8s_linear_infinite]" />
      )}
      {children}
    </button>
  );
}
