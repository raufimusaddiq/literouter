"use client";

export default function SecurityWarning({ message, action }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-warning">
      <span aria-hidden="true" className="material-symbols-outlined mt-0.5 shrink-0 text-[16px]">warning</span>
      <p className="flex-1 text-[12.5px]">{message}</p>
      {action && (
        <a
          href={action.href}
          className="shrink-0 text-[12.5px] font-semibold underline underline-offset-[3px] hover:opacity-80"
          onClick={action.href.startsWith("#") ? (e) => {
            e.preventDefault();
            document.getElementById(action.href.slice(1))?.scrollIntoView({ behavior: "smooth" });
          } : undefined}
        >
          {action.label}
        </a>
      )}
    </div>
  );
}
