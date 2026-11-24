import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';

export type AlertTone = 'info' | 'success' | 'warning' | 'error';

interface AlertProps {
  tone?: AlertTone;
  title?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

const TONE_MAP: Record<
  AlertTone,
  {
    container: string;
    iconColor: string;
    titleColor: string;
    Icon: React.ComponentType<{ className?: string }>;
  }
> = {
  info: {
    container:
      'bg-[#EEF3FF] dark:bg-[#13254A] border-[#C7D6FE] dark:border-[#2B4C8C] text-[#111827] dark:text-[#E2E8F0]',
    iconColor: 'text-[#0A2DB8] dark:text-[#60A5FA]',
    titleColor: 'text-[#0A2DB8] dark:text-[#F8FAFC]',
    Icon: Info,
  },
  success: {
    container:
      'bg-[#ECFDF5] dark:bg-[#064E3B]/35 border-[#A7F3D0] dark:border-[#059669]/45 text-[#065F46] dark:text-[#D1FAE5]',
    iconColor: 'text-[#047857] dark:text-[#6EE7B7]',
    titleColor: 'text-[#065F46] dark:text-[#ECFDF5]',
    Icon: CheckCircle2,
  },
  warning: {
    container:
      'bg-[#FFF7ED] dark:bg-[#2B1A12] border-[#FED7AA] dark:border-[#7C3D1F] text-[#9A3412] dark:text-[#FED7AA]',
    iconColor: 'text-[#F97316] dark:text-[#FB923C]',
    titleColor: 'text-[#9A3412] dark:text-[#FFEDD5]',
    Icon: AlertTriangle,
  },
  error: {
    container:
      'bg-[#FEF2F2] dark:bg-[#450A0A]/55 border-[#FECACA] dark:border-[#991B1B]/60 text-[#991B1B] dark:text-[#FECACA]',
    iconColor: 'text-[#DC2626] dark:text-[#FCA5A5]',
    titleColor: 'text-[#991B1B] dark:text-[#FEE2E2]',
    Icon: AlertCircle,
  },
};

export function Alert({ tone = 'info', title, children, action, className = '' }: AlertProps) {
  const styles = TONE_MAP[tone];
  const Icon = styles.Icon;

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-xl border p-4 flex flex-col sm:flex-row sm:items-start justify-between gap-3 ${styles.container} ${className}`}
    >
      <div className="flex items-start gap-3">
        <Icon className={`h-5 w-5 shrink-0 mt-0.5 ${styles.iconColor}`} aria-hidden="true" />
        <div className="text-sm leading-relaxed">
          {title && <p className={`font-semibold mb-0.5 ${styles.titleColor}`}>{title}</p>}
          <div>{children}</div>
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
