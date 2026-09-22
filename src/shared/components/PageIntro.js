"use client";

import PropTypes from "prop-types";
import { cn } from "@/shared/utils/cn";

export default function PageIntro({ eyebrow, title, description, action, children, className }) {
  return (
    <header className={cn("flex flex-col gap-5 border-b border-border-subtle pb-6 lg:flex-row lg:items-end lg:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="page-kicker text-text-muted">{eyebrow}</p> : null}
        <h2 className="mt-2 max-w-4xl text-3xl font-semibold leading-[1.05] tracking-[-0.06em] text-text-main sm:text-4xl">{title}</h2>
        {description ? <p className="mt-3 max-w-2xl text-sm leading-6 text-text-muted">{description}</p> : null}
        {children}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

PageIntro.propTypes = {
  eyebrow: PropTypes.string,
  title: PropTypes.node.isRequired,
  description: PropTypes.node,
  action: PropTypes.node,
  children: PropTypes.node,
  className: PropTypes.string,
};
