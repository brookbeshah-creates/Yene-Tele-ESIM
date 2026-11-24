import React, { useEffect, useRef, useState } from 'react';
import { Check, Laptop, Moon, Sun } from 'lucide-react';
import { useLanguage } from '../../contexts/LanguageContext';
import { type ThemePreference, useTheme } from '../../contexts/ThemeContext';

interface ThemeSwitcherProps {
  variant?: 'segmented' | 'dropdown';
  invertedHeader?: boolean;
}

export function ThemeSwitcher({
  variant = 'dropdown',
  invertedHeader = false,
}: ThemeSwitcherProps) {
  const { themePreference, resolvedTheme, setThemePreference } = useTheme();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

  const options: Array<{
    value: ThemePreference;
    label: string;
    Icon: React.ComponentType<{ className?: string }>;
  }> = [
    { value: 'light', label: t.theme.light, Icon: Sun },
    { value: 'dark', label: t.theme.dark, Icon: Moon },
    { value: 'system', label: t.theme.system, Icon: Laptop },
  ];

  const ActiveIcon =
    themePreference === 'system' ? Laptop : resolvedTheme === 'dark' ? Moon : Sun;

  if (variant === 'segmented') {
    return (
      <div
        role="radiogroup"
        aria-label={t.theme.label}
        className="inline-flex items-center p-1 rounded-xl border border-[#E5E7EB] dark:border-[#24344D] bg-[#F8FAFC] dark:bg-[#111C2E] gap-1"
      >
        {options.map(({ value, label, Icon }) => {
          const active = themePreference === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setThemePreference(value)}
              className={`inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A2DB8] dark:focus-visible:ring-[#60A5FA] ${
                active
                  ? 'bg-white dark:bg-[#1C2D45] text-[#0A2DB8] dark:text-[#60A5FA] shadow-xs border border-[#E5E7EB] dark:border-[#334866]'
                  : 'text-[#64748B] dark:text-[#CBD5E1] hover:text-[#111827] dark:hover:text-[#F8FAFC]'
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    );
  }

  const currentOption = options.find((o) => o.value === themePreference) ?? options[2];

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t.theme.label}: ${currentOption.label}`}
        title={`${t.theme.label}: ${currentOption.label}`}
        className={`inline-flex items-center gap-1.5 min-h-[40px] sm:min-h-[36px] px-2.5 rounded-lg border text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 dark:focus-visible:ring-[#60A5FA] ${
          invertedHeader
            ? 'border-white/25 bg-white/10 text-white hover:bg-white/20'
            : 'border-[#E5E7EB] dark:border-[#24344D] bg-white dark:bg-[#162338] text-[#111827] dark:text-[#F8FAFC] hover:bg-[#EEF3FF]/60 dark:hover:bg-[#1C2D45]'
        }`}
      >
        <ActiveIcon
          className={`h-3.5 w-3.5 shrink-0 ${
            invertedHeader ? 'text-[#DCE7FF]' : 'text-[#0A2DB8] dark:text-[#60A5FA]'
          }`}
          aria-hidden="true"
        />
        <span className="hidden sm:inline">{currentOption.label}</span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t.theme.label}
          className="absolute right-0 top-full mt-2 z-50 w-44 rounded-xl border border-[#E5E7EB] dark:border-[#24344D] bg-white dark:bg-[#162338] p-1.5 shadow-[var(--yegna-shadow-elevated)]"
        >
          <div className="px-2.5 py-1.5 text-[11px] font-medium text-[#64748B] dark:text-[#94A3B8]">
            {t.theme.label}
          </div>
          {options.map(({ value, label, Icon }) => {
            const selected = themePreference === value;
            return (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  setThemePreference(value);
                  setOpen(false);
                }}
                className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  selected
                    ? 'bg-[#EEF3FF] dark:bg-[#13254A] text-[#0A2DB8] dark:text-[#60A5FA]'
                    : 'text-[#111827] dark:text-[#F8FAFC] hover:bg-[#F8FAFC] dark:hover:bg-[#1C2D45]'
                }`}
              >
                <span className="inline-flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{label}</span>
                </span>
                {selected && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
