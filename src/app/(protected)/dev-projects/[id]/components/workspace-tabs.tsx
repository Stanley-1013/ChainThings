"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ReposTab } from "./repos-tab";
import { IssuesTab } from "./issues-tab";
import { PrsTab } from "./prs-tab";
import { ReviewsTab } from "./reviews-tab";
import { LinksTab } from "./links-tab";

type TabValue = "repos" | "issues" | "prs" | "reviews" | "links";
const VALID_TABS: TabValue[] = ["repos", "issues", "prs", "reviews", "links"];

function isValidTab(v: string | null): v is TabValue {
  return VALID_TABS.includes(v as TabValue);
}

interface Integration {
  service: string;
  status: string;
}

interface WorkspaceTabsProps {
  projectId: string;
  defaultRepoRef: string | null;
  defaultJiraProject: string | null;
  integrations: Integration[];
}

export function WorkspaceTabs({
  projectId,
  defaultRepoRef,
  defaultJiraProject,
  integrations,
}: WorkspaceTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const rawTab = searchParams.get("tab");
  const activeTab: TabValue = isValidTab(rawTab) ? rawTab : "repos";

  const changeTab = useCallback(
    (value: TabValue) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", value);
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  return (
    <Tabs
      value={activeTab}
      onValueChange={(v) => changeTab(v as TabValue)}
      className="w-full"
    >
      <TabsList className="flex w-full h-auto gap-0.5 p-1 flex-wrap">
        <TabsTrigger value="repos" className="flex-1 min-w-fit text-xs sm:text-sm">
          Repos
        </TabsTrigger>
        <TabsTrigger value="issues" className="flex-1 min-w-fit text-xs sm:text-sm">
          Issues
        </TabsTrigger>
        <TabsTrigger value="prs" className="flex-1 min-w-fit text-xs sm:text-sm">
          Pull Requests
        </TabsTrigger>
        <TabsTrigger value="reviews" className="flex-1 min-w-fit text-xs sm:text-sm">
          Reviews
        </TabsTrigger>
        <TabsTrigger value="links" className="flex-1 min-w-fit text-xs sm:text-sm">
          Links
        </TabsTrigger>
      </TabsList>

      <TabsContent value="repos" className="mt-4">
        <ReposTab projectId={projectId} integrations={integrations} />
      </TabsContent>

      <TabsContent value="issues" className="mt-4">
        <IssuesTab
          projectId={projectId}
          defaultProjectRef={defaultJiraProject}
          defaultRepoRef={defaultRepoRef}
          integrations={integrations}
        />
      </TabsContent>

      <TabsContent value="prs" className="mt-4">
        <PrsTab projectId={projectId} defaultRepoRef={defaultRepoRef} />
      </TabsContent>

      <TabsContent value="reviews" className="mt-4">
        <ReviewsTab projectId={projectId} />
      </TabsContent>

      <TabsContent value="links" className="mt-4">
        <LinksTab projectId={projectId} />
      </TabsContent>
    </Tabs>
  );
}
