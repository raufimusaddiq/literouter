"use client";

import { useId } from "react";
import { cn } from "@/shared/utils/cn";

export default function Input({
  label,
  type = "text",
  placeholder,
  value,
  onChange,
  error,
  hint,
  icon,
  disabled = false,
  required = false,
  className,
  inputClassName,
  ...props
}) {
  const generatedId = useId();
  const inputId = props.id || generatedId;
  const messageId = `${inputId}-message`;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={inputId} className="text-[13px] font-medium text-ink">
          {label}
          {required && <span className="text-danger ml-1">*</span>}
        </label>
      )}
      <div className="relative">
        {icon && (
          <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-muted">
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">{icon}</span>
          </div>
        )}
        <input
          id={inputId}
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          disabled={disabled}
          className={cn(
            "w-full h-9 max-sm:min-h-11 px-3 text-[16px] sm:text-sm text-ink bg-raise rounded-md",
            "border border-line-strong placeholder:text-faint",
            "focus:outline-none focus:ring-2 focus:ring-mark-line focus:border-mark-line",
            "transition-[background-color,border-color,box-shadow] duration-150 ease-out disabled:opacity-50 disabled:cursor-not-allowed",
            icon && "pl-9",
            error && "border-danger focus:ring-2 focus:ring-danger focus:border-danger",
            inputClassName
          )}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error || hint ? messageId : undefined}
          {...props}
        />
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
