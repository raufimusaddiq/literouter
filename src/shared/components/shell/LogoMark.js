"use client";

export default function LogoMark({ size = 22, className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 22 22"
      aria-hidden="true"
      className={className}
    >
      <circle cx="4" cy="5" r="2.5" fill="currentColor" />
      <circle cx="4" cy="17" r="2.5" fill="currentColor" />
      <path
        d="M6.5 5 H10 C13 5 13 11 16 11 H19 M6.5 17 H10 C13 17 13 11 16 11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <circle cx="19" cy="11" r="2.5" fill="var(--color-mark)" />
    </svg>
  );
}
