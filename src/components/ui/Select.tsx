import React, { useId } from 'react';
import { ChevronDown } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  helperText?: string;
  error?: string;
  options: SelectOption[];
}

export function Select({
  label,
  helperText,
  error,
  options,
  id,
  className = '',
  ...props
}: SelectProps) {
  const autoId = useId();
  const selectId = id ?? autoId;

  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={selectId}
          className="block text-sm font-medium text-[#111827] dark:text-[#F8FAFC] mb-1.5"
        >
          {label}
        </label>
      )}
      <div className="relative">
        <select
          id={selectId}
          className={`w-full min-h-[44px] sm:min-h-[40px] appearance-none bg-white dark:bg-[#111C2E] text-sm text-[#111827] dark:text-[#F8FAFC] border rounded-lg pl-3 pr-9 transition-colors focus:outline-none focus:ring-2 focus:ring-[#0A2DB8]/20 dark:focus:ring-[#3B82F6]/30 focus:border-[#0A2DB8] dark:focus:border-[#3B82F6] disabled:bg-[#F8FAFC] dark:disabled:bg-[#0B1220] disabled:text-[#64748B] ${
            error
              ? 'border-[#DC2626] dark:border-[#F87171]'
              : 'border-[#E5E7EB] dark:border-[#24344D]'
          } ${className}`}
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown
          className="h-4 w-4 text-[#64748B] dark:text-[#94A3B8] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
          aria-hidden="true"
        />
      </div>
      {error ? (
        <p className="mt-1.5 text-xs font-medium text-[#DC2626] dark:text-[#FCA5A5]" role="alert">
          {error}
        </p>
      ) : (
        helperText && (
          <p className="mt-1.5 text-xs text-[#64748B] dark:text-[#94A3B8]">{helperText}</p>
        )
      )}
    </div>
  );
}
