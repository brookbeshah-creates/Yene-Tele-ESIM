import React from 'react';

export type CardVariant =
  | 'default'
  | 'subtle'
  | 'interactive'
  | 'selected'
  | 'disabled'
  | 'highlight';

interface CardProps {
  children: React.ReactNode;
  variant?: CardVariant;
  className?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  onClick?: () => void;
  disabled?: boolean;
}

const PADDING_MAP = {
  none: '',
  sm: 'p-4',
  md: 'p-5 sm:p-6',
  lg: 'p-6 sm:p-8',
};

const VARIANT_CLASSES: Record<CardVariant, string> = {
  default:
    'bg-white dark:bg-[#162338] border border-[#E5E7EB] dark:border-[#24344D] shadow-[var(--yegna-shadow-card)]',
  subtle:
    'bg-[#F8FAFC] dark:bg-[#111C2E] border border-[#E5E7EB] dark:border-[#24344D]',
  interactive:
    'bg-white dark:bg-[#162338] border border-[#E5E7EB] dark:border-[#24344D] hover:border-[#0A2DB8]/65 dark:hover:border-[#3B82F6]/70 hover:bg-[#EEF3FF]/45 dark:hover:bg-[#1C2D45] transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A2DB8] dark:focus-visible:ring-[#60A5FA]',
  selected:
    'bg-[#EEF3FF] dark:bg-[#13254A] border-2 border-[#0A2DB8] dark:border-[#3B82F6] shadow-[var(--yegna-shadow-card)] transition-colors duration-150',
  disabled:
    'bg-[#F8FAFC] dark:bg-[#111C2E]/70 border border-[#E5E7EB] dark:border-[#24344D]/60 opacity-60 cursor-not-allowed',
  highlight:
    'bg-[#EEF3FF] dark:bg-[#13254A] border border-[#C7D6FE] dark:border-[#2B4C8C] shadow-[var(--yegna-shadow-card)]',
};

export function Card({
  children,
  variant = 'default',
  className = '',
  padding = 'md',
  onClick,
  disabled = false,
}: CardProps) {
  const effectiveVariant: CardVariant = disabled ? 'disabled' : variant;
  const classes = `rounded-xl ${VARIANT_CLASSES[effectiveVariant]} ${PADDING_MAP[padding]} ${className}`;

  if (onClick && !disabled) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        }}
        className={classes}
      >
        {children}
      </div>
    );
  }

  return <div className={classes}>{children}</div>;
}

interface CardHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  eyebrow?: string;
}

export function CardHeader({ title, subtitle, action, eyebrow }: CardHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-xs font-semibold text-[#0A2DB8] dark:text-[#60A5FA] mb-1">
            {eyebrow}
          </p>
        )}
        <h2 className="text-base font-semibold text-[#111827] dark:text-[#F8FAFC] leading-snug">
          {title}
        </h2>
        {subtitle && (
          <p className="text-sm text-[#64748B] dark:text-[#CBD5E1] mt-0.5 leading-relaxed">
            {subtitle}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardFooter({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`mt-4 pt-3.5 border-t border-[#E5E7EB] dark:border-[#24344D] flex flex-wrap items-center justify-between gap-3 ${className}`}
    >
      {children}
    </div>
  );
}
