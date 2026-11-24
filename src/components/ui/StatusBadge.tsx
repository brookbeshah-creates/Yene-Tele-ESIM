import React from 'react';
import {
  AlertTriangle,
  Archive,
  Ban,
  CalendarClock,
  CheckCircle2,
  Clock,
  FlaskConical,
  Loader2,
  PauseCircle,
  RotateCcw,
  ShieldCheck,
  Undo2,
  UserCheck,
  XCircle,
} from 'lucide-react';
import type { StatusKind } from '../../types/domain';
import { useLanguage } from '../../contexts/LanguageContext';

interface StatusBadgeProps {
  status: StatusKind;
  label?: string;
  labelOverride?: string;
}

const STATUS_STYLE_MAP: Record<
  StatusKind,
  {
    bg: string;
    text: string;
    border: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  successful: {
    bg: 'bg-[#ECFDF5] dark:bg-[#064E3B]/45',
    text: 'text-[#047857] dark:text-[#6EE7B7]',
    border: 'border-[#A7F3D0] dark:border-[#059669]/50',
    icon: CheckCircle2,
  },
  active: {
    bg: 'bg-[#ECFDF5] dark:bg-[#064E3B]/45',
    text: 'text-[#047857] dark:text-[#6EE7B7]',
    border: 'border-[#A7F3D0] dark:border-[#059669]/50',
    icon: CheckCircle2,
  },
  verified: {
    bg: 'bg-[#ECFDF5] dark:bg-[#064E3B]/45',
    text: 'text-[#047857] dark:text-[#6EE7B7]',
    border: 'border-[#A7F3D0] dark:border-[#059669]/50',
    icon: ShieldCheck,
  },
  failed: {
    bg: 'bg-[#FEF2F2] dark:bg-[#7F1D1D]/45',
    text: 'text-[#B91C1C] dark:text-[#FCA5A5]',
    border: 'border-[#FECACA] dark:border-[#DC2626]/50',
    icon: XCircle,
  },
  pending: {
    bg: 'bg-[#FFF7ED] dark:bg-[#3D2316]',
    text: 'text-[#C2410C] dark:text-[#FDBA74]',
    border: 'border-[#FED7AA] dark:border-[#7C3D1F]',
    icon: Clock,
  },
  sandbox: {
    bg: 'bg-[#FFF7ED] dark:bg-[#3D2316]',
    text: 'text-[#C2410C] dark:text-[#FDBA74]',
    border: 'border-[#FED7AA] dark:border-[#7C3D1F]',
    icon: FlaskConical,
  },
  manual: {
    bg: 'bg-[#EEF3FF] dark:bg-[#13254A]',
    text: 'text-[#0A2DB8] dark:text-[#93C5FD]',
    border: 'border-[#C7D6FE] dark:border-[#2B4C8C]',
    icon: UserCheck,
  },
  processing: {
    bg: 'bg-[#EEF3FF] dark:bg-[#13254A]',
    text: 'text-[#0A2DB8] dark:text-[#93C5FD]',
    border: 'border-[#C7D6FE] dark:border-[#2B4C8C]',
    icon: Loader2,
  },
  scheduled: {
    bg: 'bg-[#EEF3FF] dark:bg-[#13254A]',
    text: 'text-[#0A2DB8] dark:text-[#93C5FD]',
    border: 'border-[#C7D6FE] dark:border-[#2B4C8C]',
    icon: CalendarClock,
  },
  paused: {
    bg: 'bg-[#FFFBEB] dark:bg-[#451A03]/55',
    text: 'text-[#B45309] dark:text-[#FCD34D]',
    border: 'border-[#FDE68A] dark:border-[#92400E]/60',
    icon: PauseCircle,
  },
  coming_soon: {
    bg: 'bg-[#F8FAFC] dark:bg-[#1C2D45]',
    text: 'text-[#64748B] dark:text-[#CBD5E1]',
    border: 'border-[#E5E7EB] dark:border-[#334866]',
    icon: Clock,
  },
  neutral: {
    bg: 'bg-[#F8FAFC] dark:bg-[#1C2D45]',
    text: 'text-[#64748B] dark:text-[#CBD5E1]',
    border: 'border-[#E5E7EB] dark:border-[#334866]',
    icon: Clock,
  },
  cancelled: {
    bg: 'bg-[#F8FAFC] dark:bg-[#1C2D45]',
    text: 'text-[#64748B] dark:text-[#CBD5E1]',
    border: 'border-[#E5E7EB] dark:border-[#334866]',
    icon: Ban,
  },
  refunded: {
    bg: 'bg-[#EEF3FF] dark:bg-[#13254A]',
    text: 'text-[#0A2DB8] dark:text-[#93C5FD]',
    border: 'border-[#C7D6FE] dark:border-[#2B4C8C]',
    icon: RotateCcw,
  },
  reversed: {
    bg: 'bg-[#FFF7ED] dark:bg-[#3D2316]',
    text: 'text-[#C2410C] dark:text-[#FDBA74]',
    border: 'border-[#FED7AA] dark:border-[#7C3D1F]',
    icon: Undo2,
  },
  archived: {
    bg: 'bg-[#F1F5F9] dark:bg-[#1C2D45]',
    text: 'text-[#64748B] dark:text-[#CBD5E1]',
    border: 'border-[#E5E7EB] dark:border-[#334866]',
    icon: Archive,
  },
};

export function StatusBadge({ status, label: customLabel, labelOverride }: StatusBadgeProps) {
  const { t } = useLanguage();
  const cfg = STATUS_STYLE_MAP[status] ?? {
    bg: 'bg-[#F8FAFC] dark:bg-[#1C2D45]',
    text: 'text-[#64748B] dark:text-[#CBD5E1]',
    border: 'border-[#E5E7EB] dark:border-[#334866]',
    icon: AlertTriangle,
  };
  const Icon = cfg.icon;
  const label = customLabel ?? labelOverride ?? (t.statuses as Record<string, string>)[status] ?? status;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium whitespace-nowrap shrink-0 ${cfg.bg} ${cfg.text} ${cfg.border}`}
    >
      <Icon
        className={`h-3.5 w-3.5 shrink-0 ${status === 'processing' ? 'animate-spin' : ''}`}
        aria-hidden="true"
      />
      <span>{label}</span>
    </span>
  );
}
