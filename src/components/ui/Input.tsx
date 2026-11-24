import React, { useId, useState } from 'react';
import { Eye, EyeOff, Search } from 'lucide-react';

interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  helperText?: string;
  error?: string;
  inputKind?: 'text' | 'password' | 'search' | 'phone' | 'currency';
}

export function Input({
  label,
  helperText,
  error,
  inputKind = 'text',
  className = '',
  id,
  type,
  ...props
}: InputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const [showPassword, setShowPassword] = useState(false);

  const resolvedType =
    inputKind === 'password'
      ? showPassword
        ? 'text'
        : 'password'
      : inputKind === 'search'
        ? 'search'
        : inputKind === 'phone'
          ? 'tel'
          : inputKind === 'currency'
            ? 'number'
            : (type ?? 'text');

  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={inputId}
          className="block text-sm font-medium text-[#111827] dark:text-[#F8FAFC] mb-1.5"
        >
          {label}
        </label>
      )}
      <div className="relative flex items-center">
        {inputKind === 'search' && (
          <Search
            className="h-4 w-4 text-[#64748B] dark:text-[#94A3B8] absolute left-3 pointer-events-none"
            aria-hidden="true"
          />
        )}
        {inputKind === 'phone' && (
          <span className="inline-flex items-center px-3 min-h-[44px] sm:min-h-[40px] rounded-l-lg border border-r-0 border-[#E5E7EB] dark:border-[#24344D] bg-[#F8FAFC] dark:bg-[#111C2E] text-sm font-medium text-[#64748B] dark:text-[#CBD5E1] tabular-nums select-none">
            +251
          </span>
        )}
        <input
          id={inputId}
          type={resolvedType}
          className={`w-full min-h-[44px] sm:min-h-[40px] bg-white dark:bg-[#111C2E] text-sm text-[#111827] dark:text-[#F8FAFC] placeholder:text-[#94A3B8] dark:placeholder:text-[#64748B] border transition-colors focus:outline-none focus:ring-2 focus:ring-[#0A2DB8]/20 dark:focus:ring-[#3B82F6]/30 focus:border-[#0A2DB8] dark:focus:border-[#3B82F6] disabled:bg-[#F8FAFC] dark:disabled:bg-[#0B1220] disabled:text-[#64748B] ${
            error
              ? 'border-[#DC2626] dark:border-[#F87171] focus:border-[#DC2626] focus:ring-[#DC2626]/20'
              : 'border-[#E5E7EB] dark:border-[#24344D]'
          } ${inputKind === 'phone' ? 'rounded-r-lg px-3 tabular-nums' : 'rounded-lg'} ${
            inputKind === 'search' ? 'pl-9 pr-3' : inputKind !== 'phone' ? 'px-3' : ''
          } ${inputKind === 'password' ? 'pr-10' : ''} ${
            inputKind === 'currency' ? 'pr-14 tabular-nums' : ''
          } ${className}`}
          {...props}
        />
        {inputKind === 'password' && (
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="absolute right-2 p-1.5 text-[#64748B] dark:text-[#94A3B8] hover:text-[#111827] dark:hover:text-[#F8FAFC] rounded-md cursor-pointer"
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
        {inputKind === 'currency' && (
          <span className="absolute right-3 text-xs font-semibold text-[#64748B] dark:text-[#CBD5E1] pointer-events-none">
            ETB
          </span>
        )}
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

interface SelectOption {
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
  className = '',
  id,
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
      <select
        id={selectId}
        className={`w-full min-h-[44px] sm:min-h-[40px] px-3 bg-white dark:bg-[#111C2E] text-sm text-[#111827] dark:text-[#F8FAFC] border rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-[#0A2DB8]/20 dark:focus:ring-[#3B82F6]/30 focus:border-[#0A2DB8] dark:focus:border-[#3B82F6] disabled:bg-[#F8FAFC] dark:disabled:bg-[#0B1220] disabled:text-[#64748B] ${
          error
            ? 'border-[#DC2626] dark:border-[#F87171] focus:border-[#DC2626] focus:ring-[#DC2626]/20'
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

