import { GTProvider, initializeGT } from "gt-react";
import { createElement, type ReactNode } from "react";
import { vi } from "vite-plus/test";

import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "../src/i18n/locales";

// The app initializes GT at startup, and gt-i18n throws when its config is read before that.
// Unit tests render under Node, so they take the server-runtime initializer rather than the SPA
// one browserSetup.ts uses. English is the source text, so no catalog is loaded.
initializeGT({
  defaultLocale: DEFAULT_LOCALE,
  locales: [...SUPPORTED_LOCALES],
  loadTranslations: () => Promise.resolve({}),
  cacheExpiryTime: null,
});

// The app mounts everything under I18nProvider, so components reaching for GT's hooks find its
// context. Unit tests build their own roots, so the provider goes on every root here rather than
// in each one. It renders no element of its own, so the tested DOM is unchanged.
vi.mock("react-dom/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom/client")>();
  return {
    ...actual,
    createRoot: (...args: Parameters<typeof actual.createRoot>) => {
      const root = actual.createRoot(...args);
      return {
        render: (node: ReactNode) =>
          root.render(
            createElement(GTProvider, { locale: DEFAULT_LOCALE, translations: {} }, node),
          ),
        unmount: () => root.unmount(),
      };
    },
  };
});
