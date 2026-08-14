import { Tabs } from "@base-ui/react/tabs";
import type { ReactNode } from "react";

import { ScrollArea } from "../ui/scroll-area";

export function UsageTabs({
  subscriptions,
  apiEquivalent,
}: {
  readonly subscriptions: ReactNode;
  readonly apiEquivalent: ReactNode;
}) {
  return (
    <Tabs.Root defaultValue="subscriptions" className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border">
        <Tabs.List
          aria-label="Usage views"
          activateOnFocus
          className="mx-auto flex h-11 w-full max-w-6xl items-stretch gap-6 px-6"
        >
          <UsageTab value="subscriptions">Subscriptions</UsageTab>
          <UsageTab value="api-equivalent">API equivalent</UsageTab>
        </Tabs.List>
      </div>

      <UsageTabPanel value="subscriptions">{subscriptions}</UsageTabPanel>
      <UsageTabPanel value="api-equivalent">{apiEquivalent}</UsageTabPanel>
    </Tabs.Root>
  );
}

function UsageTab({ value, children }: { readonly value: string; readonly children: ReactNode }) {
  return (
    <Tabs.Tab
      value={value}
      className="relative -mb-px inline-flex cursor-pointer items-center border-b-2 border-transparent px-0.5 text-sm font-medium text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none data-active:border-foreground data-active:text-foreground"
    >
      {children}
    </Tabs.Tab>
  );
}

function UsageTabPanel({
  value,
  children,
}: {
  readonly value: string;
  readonly children: ReactNode;
}) {
  return (
    <Tabs.Panel
      value={value}
      keepMounted
      className="min-h-0 flex-1 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-6">{children}</div>
      </ScrollArea>
    </Tabs.Panel>
  );
}
