import React from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive' | 'orange';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-[#0A2DB8] text-white hover:bg-[#082499] dark:bg-[#3B82F6] dark:text-white dark:hover:bg-[#2563EB] focus-visible:ring-2 focus-visible:ring-[#0A2DB8] dark:focus-visible:ring-[#60A5FA] focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#0B1220] border border-transparent',
  secondary:
    'bg-white dark:bg-[#162338] text-[#111827] dark:text-[#F8FAFC] border border-[#E5E7EB] dark:border-[#24344D] hover:bg-[#EEF3FF]/60 dark:hover:bg-[#1C2D45] hover:border-[#0A2DB8]/40 dark:hover:border-[#3B82F6]/60 focus-visible:ring-2 focus-visible:ring-[#0A2DB8] dark:focus-visible:ring-[#60A5FA] focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#0B1220]',
  tertiary:
    'bg-transparent text-[#0A2DB8] dark:text-[#60A5FA] hover:bg-[#EEF3FF] dark:hover:bg-[#13254A] border border-transparent focus-visible:ring-2 focus-visible:ring-[#0A2DB8] dark:focus-visible:ring-[#60A5FA] focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#0B1220]',
  destructive:
    'bg-[#DC2626] text-white hover:bg-[#B91C1C] dark:bg-[#EF4444] dark:text-white dark:hover:bg-[#DC2626] focus-visible:ring-2 focus-visible:ring-[#DC2626] focus-visible:ring-offset-2 border border-transparent',
  orange:
    'bg-[#F97316] text-white hover:bg-[#EA580C] dark:bg-[#F97316] dark:text-white dark:hover:bg-[#EA580C] focus-visible:ring-2 focus-visible:ring-[#F97316] focus-visible:ring-offset-2 border border-transparent',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'min-h-[40px] px-3.5 text-sm rounded-lg',
  md: 'min-h-[44px] sm:min-h-[40px] px-4 text-sm rounded-lg',
  lg: 'min-h-[48px] px-6 text-base rounded-xl',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  leftIcon,
  rightIcon,
  disabled,
  className = '',
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      type={type}
      disabled={isDisabled}
      className={`inline-flex items-center justify-center gap-2 font-semibold transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : leftIcon}
      <span>{children}</span>
      {!loading && rightIcon}
    </button>
  );
}
