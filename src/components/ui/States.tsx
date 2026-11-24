import React from 'react';
import { AlertCircle, Inbox, Loader2 } from 'lucide-react';
import { Button } from './Button';

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-[#162338] border border-[#E5E7EB] dark:border-[#24344D] rounded-xl p-8 text-center flex flex-col items-center justify-center">
      <div className="h-11 w-11 rounded-xl bg-[#EEF3FF] dark:bg-[#13254A] text-[#0A2DB8] dark:text-[#60A5FA] flex items-center justify-center mb-3">
        {icon ?? <Inbox className="h-5 w-5" aria-hidden="true" />}
      </div>
      <h3 className="text-base font-semibold text-[#111827] dark:text-[#F8FAFC]">{title}</h3>
      <p className="text-sm text-[#64748B] dark:text-[#CBD5E1] max-w-md mt-1 leading-relaxed">
        {description}
      </p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function LoadingState({ message = 'Loading workspace data...' }: { message?: string }) {
  return (
    <div className="bg-white dark:bg-[#162338] border border-[#E5E7EB] dark:border-[#24344D] rounded-xl p-8 flex flex-col items-center justify-center text-center">
      <Loader2
        className="h-6 w-6 text-[#0A2DB8] dark:text-[#60A5FA] animate-spin mb-3"
        aria-hidden="true"
      />
      <p className="text-sm font-medium text-[#64748B] dark:text-[#CBD5E1]">{message}</p>
    </div>
  );
}

export function ErrorState({
  title = 'Unable to load data',
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="bg-white dark:bg-[#162338] border border-[#FECACA] dark:border-[#991B1B]/60 rounded-xl p-6 flex flex-col items-center justify-center text-center">
      <div className="h-10 w-10 rounded-xl bg-[#FEF2F2] dark:bg-[#450A0A]/60 text-[#DC2626] dark:text-[#FCA5A5] flex items-center justify-center mb-3">
        <AlertCircle className="h-5 w-5" aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold text-[#111827] dark:text-[#F8FAFC]">{title}</h3>
      <p className="text-sm text-[#64748B] dark:text-[#CBD5E1] max-w-md mt-1">{message}</p>
      {onRetry && (
        <div className="mt-4">
          <Button variant="secondary" onClick={onRetry}>
            Try Again
          </Button>
        </div>
      )}
    </div>
  );
}

export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div
      aria-busy="true"
      aria-label="Loading card"
      className="bg-white dark:bg-[#162338] border border-[#E5E7EB] dark:border-[#24344D] rounded-xl p-5 space-y-3 animate-pulse"
    >
      <div className="h-4 w-1/3 rounded bg-[#E5E7EB] dark:bg-[#24344D]" />
      <div className="h-7 w-1/2 rounded bg-[#EEF3FF] dark:bg-[#1C2D45]" />
      {Array.from({ length: Math.max(0, lines - 2) }).map((_, i) => (
        <div key={i} className="h-3.5 w-3/4 rounded bg-[#F1F5F9] dark:bg-[#1C2D45]" />
      ))}
    </div>
  );
}
