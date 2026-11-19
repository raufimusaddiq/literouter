"use client";

import PropTypes from "prop-types";
import { HeaderControls } from "@/shared/components/Header";
import { cn } from "@/shared/utils/cn";

// Compact title row: the page's single h1, an optional plain-words status line,
// and the primary action(s) on the right. The top bar carries no title.
export default function PageIntro({ title, description, action, children, className }) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="min-w-0">
        <h1 className="text-[1.375rem] font-semibold leading-8 text-text-main">{title}</h1>
        {description ? <p className="mt-0.5 max-w-3xl text-sm text-text-muted">{description}</p> : null}
        {children}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {action}
        <HeaderControls className="hidden lg:flex" />
      </div>
    </div>
  );
}

PageIntro.propTypes = {
  title: PropTypes.node.isRequired,
  description: PropTypes.node,
  action: PropTypes.node,
  children: PropTypes.node,
  className: PropTypes.string,
};
