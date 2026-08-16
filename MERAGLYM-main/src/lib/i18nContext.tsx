"use client";

import React, { createContext, useContext, useState, ReactNode, useCallback } from "react";
import { dictionaries, Locale, i18nConfig } from "./i18n";

interface I18nContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
  isRussian: boolean;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

const STORAGE_KEY = "meraglym_locale_pref";

export const I18nProvider = ({ children }: { children: ReactNode }) => {
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(STORAGE_KEY) as Locale | null;
        if (saved && i18nConfig.locales.includes(saved)) {
          return saved;
        }
      } catch {
        // Ignore localStorage read errors in SSR/sandboxes
      }
    }
    return i18nConfig.defaultLocale;
  });

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    try {
      localStorage.setItem(STORAGE_KEY, newLocale);
      document.documentElement.lang = newLocale;
    } catch {
      // Ignore storage errors
    }
  }, []);

  const toggleLocale = useCallback(() => {
    setLocale(locale === "ru" ? "en" : "ru");
  }, [locale, setLocale]);

  const t = useCallback(
    (key: string): string => {
      const keys = key.split(".");
      let value: unknown = dictionaries[locale];
      for (const k of keys) {
        if (!value || typeof value !== "object") break;
        value = (value as Record<string, unknown>)[k];
      }

      if (value === undefined || typeof value !== "string") {
        let fallbackValue: unknown = dictionaries["en"];
        for (const k of keys) {
          if (!fallbackValue || typeof fallbackValue !== "object") return key;
          fallbackValue = (fallbackValue as Record<string, unknown>)[k];
        }
        return typeof fallbackValue === "string" ? fallbackValue : key;
      }
      return value;
    },
    [locale]
  );

  return (
    <I18nContext.Provider
      value={{
        locale,
        setLocale,
        toggleLocale,
        isRussian: locale === "ru",
        t,
      }}
    >
      {children}
    </I18nContext.Provider>
  );
};

export const useI18n = () => {
  const context = useContext(I18nContext);
  if (context === undefined) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return context;
};
