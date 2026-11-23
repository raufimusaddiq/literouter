"use client";

import { cn } from "@/shared/utils/cn";

export function Skeleton({ className, ...props }) {
  return (
    <div
      className={cn(
        "rounded bg-surface-2",
        className
      )}
      {...props}
    />
  );
}

export function CardSkeleton() {
  return (
    <div className="border-t border-line-strong py-5">
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-7 w-20" />
      </div>
      <Skeleton className="h-6 w-40 mb-2" />
      <Skeleton className="h-3.5 w-24" />
    </div>
  );
}
