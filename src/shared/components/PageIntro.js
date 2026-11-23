"use client";

import PropTypes from "prop-types";
import { HeaderControls } from "@/shared/components/Header";
import { cn } from "@/shared/utils/cn";

export default function PageIntro({ title, meta, description, action, children, className }) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="min-w-0">
        {meta ? (
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="text-[1.375rem] font-semibold leading-8 text-text-main">{title}</h1>
            {meta}
          </div>
        ) : (
          <h1 className="text-[1.375rem] font-semibold leading-8 text-text-main">{title}</h1>
        )}
        {description ? <p className="mt-0.5 max-w-3xl text-sm text-text-muted">{description}</p> : null}
        {children}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {action}
        <HeaderControls />
      </div>
    </div>
  );
}

PageIntro.propTypes = {
  title: PropTypes.node.isRequired,
  meta: PropTypes.node,
  description: PropTypes.node,
  action: PropTypes.node,
  children: PropTypes.node,
  className: PropTypes.string,
};
