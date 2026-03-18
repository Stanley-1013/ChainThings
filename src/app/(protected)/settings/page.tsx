"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useCallback } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { User, Bell, Palette, Bot, Plug } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProfileSection } from "./components/profile-section";
import { NotificationSection } from "./components/notification-section";
import { AppearanceSection } from "./components/appearance-section";
import { AiSection } from "./components/ai-section";
import { IntegrationsSection } from "./components/integrations-section";

const TABS = [
  { id: "profile", label: "Profile", icon: User },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "ai", label: "AI Assistant", icon: Bot },
  { id: "integrations", label: "Integrations", icon: Plug },
] as const;

type TabId = (typeof TABS)[number]["id"];

function SettingsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const activeTab = (searchParams.get("tab") as TabId) || "profile";

  const setTab = (tab: TabId) => {
    router.replace(`/settings?tab=${tab}`, { scroll: false });
  };

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent, isVertical: boolean) => {
      const currentIdx = TABS.findIndex((t) => t.id === activeTab);
      let nextIdx = currentIdx;
      const next = isVertical ? "ArrowDown" : "ArrowRight";
      const prev = isVertical ? "ArrowUp" : "ArrowLeft";
      if (e.key === next) {
        nextIdx = (currentIdx + 1) % TABS.length;
      } else if (e.key === prev) {
        nextIdx = (currentIdx - 1 + TABS.length) % TABS.length;
      } else if (e.key === "Home") {
        nextIdx = 0;
      } else if (e.key === "End") {
        nextIdx = TABS.length - 1;
      } else {
        return;
      }
      e.preventDefault();
      setTab(TABS[nextIdx].id);
      // Focus the new tab button
      const tabEl = (e.currentTarget as HTMLElement).querySelector<HTMLButtonElement>(
        `[data-tab="${TABS[nextIdx].id}"]`
      );
      tabEl?.focus();
    },
    [activeTab]
  );

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      {/* Tab navigation */}
      {/* Desktop: vertical sidebar */}
      <nav role="tablist" aria-label="Settings" aria-orientation="vertical" className="hidden lg:flex flex-col w-52 shrink-0 space-y-1" onKeyDown={(e) => handleTabKeyDown(e, true)}>
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              data-tab={tab.id}
              tabIndex={isActive ? 0 : -1}
              aria-selected={isActive}
              aria-controls={`settings-panel-${tab.id}`}
              onClick={() => setTab(tab.id)}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-left",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* Mobile: horizontal scrollable tabs */}
      <nav role="tablist" aria-label="Settings" className="lg:hidden flex gap-1 overflow-x-auto pb-2 -mx-4 px-4 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]" onKeyDown={(e) => handleTabKeyDown(e, false)}>
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              data-tab={tab.id}
              tabIndex={isActive ? 0 : -1}
              aria-selected={isActive}
              aria-controls={`settings-panel-${tab.id}`}
              onClick={() => setTab(tab.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors shrink-0",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* Content panel */}
      <div role="tabpanel" id={`settings-panel-${activeTab}`} className="flex-1 min-w-0 max-w-2xl">
        {activeTab === "profile" && <ProfileSection />}
        {activeTab === "notifications" && <NotificationSection />}
        {activeTab === "appearance" && <AppearanceSection />}
        {activeTab === "ai" && <AiSection />}
        {activeTab === "integrations" && <IntegrationsSection />}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Manage your account, preferences, and integrations"
      />
      <Suspense>
        <SettingsContent />
      </Suspense>
    </div>
  );
}
