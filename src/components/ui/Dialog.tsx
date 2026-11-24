import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidthClass?: string;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  maxWidthClass = 'max-w-lg',
}: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#111827]/55 dark:bg-[#020617]/75 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="yegna-dialog-title"
    >
      <div className="fixed inset-0" onClick={onClose} aria-hidden="true" />
      <div
        className={`relative z-10 w-full ${maxWidthClass} bg-white dark:bg-[#162338] border border-[#E5E7EB] dark:border-[#24344D] rounded-t-2xl sm:rounded-2xl max-h-[90vh] flex flex-col shadow-[var(--yegna-shadow-elevated)]`}
      >
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-[#E5E7EB] dark:border-[#24344D]">
          <div>
            <h3
              id="yegna-dialog-title"
              className="text-base font-semibold text-[#111827] dark:text-[#F8FAFC]"
            >
              {title}
            </h3>
            {description && (
              <p className="text-sm text-[#64748B] dark:text-[#CBD5E1] mt-0.5">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="p-1.5 rounded-lg text-[#64748B] dark:text-[#94A3B8] hover:text-[#111827] dark:hover:text-[#F8FAFC] hover:bg-[#F8FAFC] dark:hover:bg-[#1C2D45] cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
        {footer && (
          <div className="px-5 py-4 border-t border-[#E5E7EB] dark:border-[#24344D] bg-[#F8FAFC] dark:bg-[#111C2E] rounded-b-2xl flex flex-wrap items-center justify-end gap-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
