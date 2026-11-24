"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { LOCALES, LOCALE_COOKIE, normalizeLocale } from "@/i18n/config";
import { reloadTranslations } from "@/i18n/runtime";
import { useEscapeLayer } from "@/shared/hooks/useEscapeLayer";

function getLocaleFromCookie() {
  if (typeof document === "undefined") return "en";
  const cookie = document.cookie
    .split(";")
    .find((c) => c.trim().startsWith(`${LOCALE_COOKIE}=`));
  const value = cookie ? decodeURIComponent(cookie.split("=")[1]) : "en";
  return normalizeLocale(value);
}

const getLocaleInfo = (locale) => {
  const locales = {
    "en": { name: "English", flag: "🇺🇸" },
    "vi": { name: "Tiếng Việt", flag: "🇻🇳" },
    "zh-CN": { name: "简体中文", flag: "🇨🇳" },
    "zh-TW": { name: "繁體中文", flag: "🇹🇼" },
    "ja": { name: "日本語", flag: "🇯🇵" },
    "pt-BR": { name: "Português (Brasil)", flag: "🇧🇷" },
    "pt-PT": { name: "Português (Portugal)", flag: "🇵🇹" },
    "ko": { name: "한국어", flag: "🇰🇷" },
    "es": { name: "Español", flag: "🇪🇸" },
    "de": { name: "Deutsch", flag: "🇩🇪" },
    "fr": { name: "Français", flag: "🇫🇷" },
    "he": { name: "עברית", flag: "🇮🇱" },
    "ar": { name: "العربية", flag: "🇸🇦" },
    "ru": { name: "Русский", flag: "🇷🇺" },
    "pl": { name: "Polski", flag: "🇵🇱" },
    "cs": { name: "Čeština", flag: "🇨🇿" },
    "nl": { name: "Nederlands", flag: "🇳🇱" },
    "tr": { name: "Türkçe", flag: "🇹🇷" },
    "uk": { name: "Українська", flag: "🇺🇦" },
    "tl": { name: "Tagalog", flag: "🇵🇭" },
    "id": { name: "Indonesia", flag: "🇮🇩" },
    "th": { name: "ไทย", flag: "🇹🇭" },
    "km": { name: "ខ្មែរ", flag: "🇰🇭" },
    "hi": { name: "हिन्दी", flag: "🇮🇳" },
    "bn": { name: "বাংলা", flag: "🇧🇩" },
    "ur": { name: "اردو", flag: "🇵🇰" },
    "ro": { name: "Română", flag: "🇷🇴" },
    "sv": { name: "Svenska", flag: "🇸🇪" },
    "it": { name: "Italiano", flag: "🇮🇹" },
    "el": { name: "Ελληνικά", flag: "🇬🇷" },
    "hu": { name: "Magyar", flag: "🇭🇺" },
    "fi": { name: "Suomi", flag: "🇫🇮" },
    "da": { name: "Dansk", flag: "🇩🇰" },
    "no": { name: "Norsk", flag: "🇳🇴" },
    "fa": { name: "فارسی", flag: "🇮🇷" }
  };
  return locales[locale] || { name: locale, flag: "🌐" };
};

export default function LanguageSwitcher({ className = "", isOpen: controlledOpen, onClose, hideTrigger = false }) {
  const [locale, setLocale] = useState("en");
  const [isPending, setIsPending] = useState(false);
  const [internalOpen, setInternalOpen] = useState(false);
  const modalRef = useRef(null);

  const isControlled = typeof controlledOpen === "boolean";
  const isOpen = isControlled ? controlledOpen : internalOpen;
  const setIsOpen = (value, nextLocale = locale) => {
    if (isControlled) {
      if (!value && onClose) onClose(nextLocale);
    } else {
      setInternalOpen(value);
    }
  };

  useEscapeLayer(isOpen, () => setIsOpen(false));

  useEffect(() => {
    (async () => {
      setLocale(getLocaleFromCookie());
    })();
  }, []);

  useEffect(() => {
    function handleClickOutside(event) {
      if (modalRef.current && !modalRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  const handleSetLocale = async (nextLocale) => {
    if (nextLocale === locale || isPending) return;

    setIsPending(true);
    try {
      await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: nextLocale }),
      });
      
      await reloadTranslations();
      setLocale(nextLocale);
      setIsOpen(false, nextLocale);
    } catch (err) {
      console.error("Failed to set locale:", err);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className={className}>
      {!hideTrigger && (
        <button
          onClick={() => setIsOpen(!isOpen)}
          disabled={isPending}
          className="flex items-center gap-2 rounded-md border border-transparent px-3 py-2 text-muted transition-colors hover:border-line hover:text-ink"
          title="Language"
          data-i18n-skip="true"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[20px]">language</span>
          <span className="text-sm font-medium">{getLocaleInfo(locale).name}</span>
          <span className="text-lg">{getLocaleInfo(locale).flag}</span>
        </button>
      )}

      {isOpen && createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" data-i18n-skip="true">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setIsOpen(false)}
          />

          <div
            ref={modalRef}
            className="relative w-full bg-raise border border-line-strong rounded-[10px] shadow-[var(--shadow-float)] fade-in max-w-2xl flex flex-col max-h-[80vh]"
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
              <h2 className="text-base font-semibold tracking-[-0.01em] text-ink">Select Language</h2>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-ink transition-colors"
                aria-label="Close"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              <div className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-2">
                {LOCALES.map((item) => {
                  const active = locale === item;
                  const info = getLocaleInfo(item);
                  return (
                    <button
                      key={item}
                      onClick={() => handleSetLocale(item)}
                      disabled={isPending}
                      className={`flex w-full flex-col items-center justify-start gap-1 rounded-md border px-2 py-3 text-xs font-medium transition-colors ${
                        active
                          ? "border-mark-line bg-surface-2 text-ink"
                          : "border-transparent text-ink hover:bg-surface-2"
                      } ${isPending ? "opacity-70 cursor-wait" : ""}`}
                      title={info.name}
                    >
                      <span className="text-2xl">{info.flag}</span>
                      <span className="text-center leading-tight line-clamp-2 h-8 flex items-center">{info.name}</span>
                      {active && (
                        <span aria-hidden="true" className="material-symbols-outlined text-sm">check</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
