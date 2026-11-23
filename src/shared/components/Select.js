"use client";

import { useId } from "react";
import { cn } from "@/shared/utils/cn";

export default function Select({
  label,
  options = [],
  value,
  onChange,
  placeholder = "Select an option",
  error,
  hint,
  disabled = false,
  required = false,
  className,
  selectClassName,
  ...props
}) {
  const generatedId = useId();
  const selectId = props.id || generatedId;
  const messageId = `${selectId}-message`;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={selectId} className="text-[13px] font-medium text-ink">
          {label}
          {required && <span className="text-danger ml-1">*</span>}
        </label>
      )}
      <div className="relative">
        <select
          id={selectId}
          value={value}
          onChange={onChange}
          disabled={disabled}
          className={cn(
            "w-full h-9 px-3 pr-9 text-[16px] sm:text-sm text-ink",
            "bg-raise border border-line-strong rounded-md appearance-none",
            "focus:outline-none focus:ring-2 focus:ring-mark-line focus:border-mark-line",
            "transition-[background-color,border-color,box-shadow] duration-150 disabled:opacity-50 disabled:cursor-not-allowed",
            error && "border-danger focus:ring-2 focus:ring-danger focus:border-danger",
            selectClassName
          )}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error || hint ? messageId : undefined}
          {...props}
        >
          <option value="" disabled>
            {placeholder}
          </option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="absolute inset-y-0 right-0 flex items-center pr-2.5 pointer-events-none text-muted">
          <span aria-hidden="true" className="material-symbols-outlined text-[18px]">expand_more</span>
        </div>
      </div>
      {error && (
        <p id={messageId} role="alert" className="flex items-center gap-1 text-xs text-danger">
          <span aria-hidden="true" className="material-symbols-outlined text-[14px]">error</span>
          {error}
        </p>
      )}
      {hint && !error && (
        <p id={messageId} className="text-xs text-muted">{hint}</p>
      )}
    </div>
  );
}
