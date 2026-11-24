import React from 'react';
import { useLanguage } from '../../contexts/LanguageContext';

interface BrandWordmarkProps {
  inverted?: boolean;
  compact?: boolean;
  showAmharic?: boolean;
  useCircularEmblem?: boolean;
}

/**
 * Geometric Yene Tele (የእኔ ቴሌኮም) brand lockup.
 * Preserves the Royal Blue (#0A2DB8) + White identity across Public, Customer, Agent, and Admin shells.
 */
export function BrandWordmark({
  inverted = false,
  compact = false,
  showAmharic = true,
  useCircularEmblem = false,
}: BrandWordmarkProps) {
  const { language } = useLanguage();

  return (
    <span className="inline-flex items-center gap-2.5 whitespace-nowrap shrink-0 select-none">
      <span
        className={`inline-flex h-8 w-8 items-center justify-center shrink-0 ${
          useCircularEmblem
            ? 'rounded-full bg-white p-0.5'
            : `rounded-lg ${
                inverted
                  ? 'bg-white text-[#0A2DB8]'
                  : 'bg-[#0A2DB8] text-white dark:bg-[#3B82F6] dark:text-white'
              }`
        }`}
        aria-hidden="true"
      >
        {useCircularEmblem ? (
          <img
            src="/assets/aistudio/image_20c4631a.png"
            alt="Yene Tele emblem"
            className="h-full w-full rounded-full object-contain"
          />
        ) : (
          <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none">
            <path
              d="M6.5 6.5L12 12.5L17.5 6.5M12 12.5V18.5"
              stroke="currentColor"
              strokeWidth="2.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="6.5" cy="6.5" r="2" fill="currentColor" />
            <circle cx="17.5" cy="6.5" r="2" fill="currentColor" />
            <circle cx="12" cy="18.5" r="2" fill="currentColor" />
          </svg>
        )}
      </span>

      <span className="inline-flex items-baseline gap-2">
        <span
          className={`font-bold tracking-tight ${compact ? 'text-base' : 'text-lg'} ${
            inverted ? 'text-white' : 'text-[#111827] dark:text-[#F8FAFC]'
          }`}
        >
          {language === 'am' ? (
            'የእኔ ቴሌኮም'
          ) : (
            <>
              Yene{' '}
              <span className={inverted ? 'text-[#DCE7FF]' : 'text-[#0A2DB8] dark:text-[#60A5FA]'}>
                Tele
              </span>
            </>
          )}
        </span>
        {!compact && showAmharic && (
          <span
            className={`hidden sm:inline text-xs font-medium ${
              inverted ? 'text-white/80' : 'text-[#64748B] dark:text-[#94A3B8]'
            }`}
            lang={language === 'am' ? 'en' : 'am'}
          >
            {language === 'am' ? 'Yene Tele' : 'የእኔ ቴሌኮም'}
          </span>
        )}
      </span>
    </span>
  );
}
