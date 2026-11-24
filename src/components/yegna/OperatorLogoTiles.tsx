import React from 'react';
import type { OperatorCode } from '../../types/domain';

interface OperatorLogoTilesProps {
  onSelect: (operator: OperatorCode) => void;
  selected?: OperatorCode | null;
}

export const OPERATOR_LOGO_MAP: Record<OperatorCode, { src: string; alt: string }> = {
  ethio_telecom: {
    src: '/assets/operators/ethiotelecom.png',
    alt: 'Ethio telecom official logo',
  },
  safaricom_ethiopia: {
    src: '/assets/operators/safaricom.png',
    alt: 'Safaricom Ethiopia official logo',
  },
};

export function OperatorLogoTiles({ onSelect, selected = null }: OperatorLogoTilesProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-5 max-w-xl mx-auto">
      <button
        type="button"
        onClick={() => onSelect('ethio_telecom')}
        aria-label="Choose Ethio telecom"
        className={`group flex items-center justify-center rounded-2xl border bg-white p-4 sm:p-6 transition-all cursor-pointer active:scale-[0.98] ${
          selected === 'ethio_telecom'
            ? 'border-[#0A2DB8] ring-2 ring-[#0A2DB8]/25 shadow-[var(--yegna-shadow-elevated)]'
            : 'border-[#E5E7EB] dark:border-[#24344D] hover:border-[#0A2DB8]/65 shadow-[var(--yegna-shadow-card)]'
        }`}
      >
        <img
          src={OPERATOR_LOGO_MAP.ethio_telecom.src}
          alt={OPERATOR_LOGO_MAP.ethio_telecom.alt}
          className="h-10 sm:h-12 w-auto max-w-full object-contain px-1"
        />
      </button>

      <button
        type="button"
        onClick={() => onSelect('safaricom_ethiopia')}
        aria-label="Choose Safaricom Ethiopia"
        className={`group flex items-center justify-center rounded-2xl border bg-white p-4 sm:p-6 transition-all cursor-pointer active:scale-[0.98] ${
          selected === 'safaricom_ethiopia'
            ? 'border-[#0A2DB8] ring-2 ring-[#0A2DB8]/25 shadow-[var(--yegna-shadow-elevated)]'
            : 'border-[#E5E7EB] dark:border-[#24344D] hover:border-[#0A2DB8]/65 shadow-[var(--yegna-shadow-card)]'
        }`}
      >
        <img
          src={OPERATOR_LOGO_MAP.safaricom_ethiopia.src}
          alt={OPERATOR_LOGO_MAP.safaricom_ethiopia.alt}
          className="h-10 sm:h-12 w-auto max-w-full object-contain px-1"
        />
      </button>
    </div>
  );
}
