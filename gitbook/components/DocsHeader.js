"use client";

import { useState } from "react";
import Link from "next/link";
import { DOCS_CONFIG, t } from "@/constants/docsConfig";
import { DEFAULT_LANG } from "@/constants/languages";
import { ExternalLink, Menu, X } from "lucide-react";
import DocsSidebar from "./DocsSidebar";
import LanguageSwitcher from "./LanguageSwitcher";

export default function DocsHeader({ lang = DEFAULT_LANG }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-50 w-full">
        <div className="mx-auto mt-4 mb-2 w-[min(96vw,72rem)] rounded-full bg-white/85 backdrop-blur-xl ring-1 ring-gray-900/10 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.45)] px-3 sm:px-5 h-14 flex items-center justify-between">
          {/* Mobile menu button */}
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="lg:hidden p-2 rounded-full hover:bg-gray-100 transition-colors duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5 text-gray-600" />
          </button>

          {/* Logo */}
          <Link href={`/${lang}`} className="flex items-center gap-2 group">
            <span className="flex size-8 items-center justify-center rounded-xl bg-[#4f46e5] font-semibold text-white text-sm tracking-[-0.04em]">LR</span>
            <span className="font-semibold tracking-[-0.04em] text-[15px] text-gray-900">
              {DOCS_CONFIG.logo}<span className="text-gray-400 font-normal"> docs</span>
            </span>
          </Link>

          {/* Right side */}
          <div className="flex items-center gap-2 sm:gap-3">
            <LanguageSwitcher currentLang={lang} />

            {/* Go to App */}
            <Link
              href={DOCS_CONFIG.appUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 pl-4 pr-2 py-1.5 bg-gray-900 text-white rounded-full font-medium text-sm transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#4f46e5] active:scale-[0.98] group"
            >
              <span className="hidden sm:inline">{t(lang, "goToApp")}</span>
              <ExternalLink className="w-3.5 h-3.5 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:-translate-y-px" />
            </Link>
          </div>
        </div>
      </header>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <>
          <div
            className="mobile-menu-overlay lg:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />

          <div className="mobile-menu-drawer lg:hidden">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <span className="font-semibold text-gray-900 tracking-[-0.04em]">{DOCS_CONFIG.logo} docs</span>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                aria-label="Close menu"
              >
                <X className="w-5 h-5 text-gray-600" />
              </button>
            </div>
            <DocsSidebar isMobile onClose={() => setMobileMenuOpen(false)} lang={lang} />
          </div>
        </>
      )}
    </>
  );
}
