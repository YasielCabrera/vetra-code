import type { Dispatch, ReactElement, SetStateAction } from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const hooks = vi.hoisted(() => {
  let cursor = 0;
  let slots: unknown[] = [];
  const nextIndex = () => cursor++;

  return {
    beginRender() {
      cursor = 0;
    },
    reset() {
      cursor = 0;
      slots = [];
    },
    useMemoCache(size: number): unknown[] {
      const index = nextIndex();
      if (!slots[index]) {
        slots[index] = Array.from({ length: size }, () => Symbol.for("react.memo_cache_sentinel"));
      }
      return slots[index] as unknown[];
    },
    useState<T>(initialValue: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
      const index = nextIndex();
      if (index >= slots.length) {
        slots[index] =
          typeof initialValue === "function" ? (initialValue as () => T)() : initialValue;
      }
      const setValue: Dispatch<SetStateAction<T>> = (nextValue) => {
        const previous = slots[index] as T;
        slots[index] =
          typeof nextValue === "function" ? (nextValue as (value: T) => T)(previous) : nextValue;
      };
      return [slots[index] as T, setValue];
    },
  };
});

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: hooks.useState,
  };
});

vi.mock("react/compiler-runtime", () => ({ c: hooks.useMemoCache }));

import { BrowserFavicon } from "./BrowserFavicon";

type ImageElement = ReactElement<{
  readonly src: string;
  readonly className: string;
  readonly onLoad: () => void;
  readonly onError: () => void;
}>;

type FaviconElement = ReactElement<{
  readonly className: string;
  readonly children: [ReactElement | null, ImageElement | null];
}>;

function renderFavicon(url: string | null, variant: "card" | "tab" = "card"): FaviconElement {
  hooks.beginRender();
  return BrowserFavicon({ url, variant }) as FaviconElement;
}

describe("BrowserFavicon", () => {
  beforeEach(() => hooks.reset());

  it("keeps the fixed fallback slot until the image loads", () => {
    const loading = renderFavicon("http://localhost:5173/app");
    expect(loading.props.className).toContain("size-7");
    expect(loading.props.children[0]).not.toBeNull();
    expect(loading.props.children[1]?.props.src).toBe("http://localhost:5173/favicon.ico");
    expect(loading.props.children[1]?.props.className).toContain("opacity-0");

    loading.props.children[1]?.props.onLoad();
    const loaded = renderFavicon("http://localhost:5173/app");
    expect(loaded.props.children[0]).toBeNull();
    expect(loaded.props.children[1]?.props.className).toContain("opacity-100");
  });

  it("falls back after an image error without retrying on the same URL", () => {
    const loading = renderFavicon("http://localhost:5173/");
    loading.props.children[1]?.props.onError();

    const failed = renderFavicon("http://localhost:5173/");
    expect(failed.props.children[0]).not.toBeNull();
    expect(failed.props.children[1]).toBeNull();
  });

  it("retries after the URL changes and supports the compact tab variant", () => {
    const first = renderFavicon("http://localhost:5173/");
    first.props.children[1]?.props.onError();

    const retry = renderFavicon("https://example.test/dashboard", "tab");
    expect(retry.props.className).toContain("size-3");
    expect(retry.props.children[0]).not.toBeNull();
    expect(retry.props.children[1]?.props.src).toBe("https://example.test/favicon.ico");
  });

  it("renders only the fallback for an invalid URL", () => {
    const invalid = renderFavicon("about:blank", "tab");
    expect(invalid.props.children[0]).not.toBeNull();
    expect(invalid.props.children[1]).toBeNull();
  });
});
