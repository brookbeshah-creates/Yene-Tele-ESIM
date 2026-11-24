import React from 'react';
import { FlaskConical } from 'lucide-react';
import { useLanguage } from '../../contexts/LanguageContext';

interface SandboxModeBannerProps {
  compact?: boolean;
}

export function SandboxModeBanner({ compact = false }: SandboxModeBannerProps) {
  const { t } = useLanguage();

  return (
    <div
      role="status"
      className={`rounded-xl border border-[#FED7AA] dark:border-[#7C3D1F] bg-[#FFF7ED] dark:bg-[#2B1A12] text-[#9A3412] dark:text-[#FED7AA] flex items-start sm:items-center gap-2.5 ${
        compact ? 'px-3.5 py-2 text-xs' : 'px-4 py-2.5 text-sm'
      }`}
    >
      <FlaskConical
        className="h-4 w-4 shrink-0 text-[#F97316] dark:text-[#FB923C] mt-0.5 sm:mt-0"
        aria-hidden="true"
      />
      <p className="leading-snug">
        <span className="font-semibold">Environment Status:</span> {t.common.sandboxBanner}
      </p>
    </div>
  );
}
