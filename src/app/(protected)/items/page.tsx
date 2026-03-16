"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { FileText, Clock, ChevronRight, Plus } from "lucide-react";

interface Item {
  id: string;
  type: string;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

function formatGroupDate(dateString: string): string {
  const date = new Date(dateString);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";

  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(dateString: string): string {
  return new Date(dateString).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ItemsListPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  const loadItems = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/items?type=meeting_note&limit=50");
      if (!res.ok) return;
      const json = await res.json();
      setItems(json.data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const grouped = useMemo(() => {
    const groups: Record<string, Item[]> = {};
    for (const item of items) {
      const key = formatGroupDate(item.created_at);
      (groups[key] ??= []).push(item);
    }
    return groups;
  }, [items]);

  const groupKeys = useMemo(() => {
    return Object.keys(grouped).sort((a, b) => {
      if (a === "Today") return -1;
      if (b === "Today") return 1;
      if (a === "Yesterday") return -1;
      if (b === "Yesterday") return 1;
      return new Date(b).getTime() - new Date(a).getTime();
    });
  }, [grouped]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <PageHeader
            title="Meeting Notes"
            description="Notes captured from your meetings"
          />
          <Link href="/items/new">
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              New
            </Button>
          </Link>
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="p-4 flex items-center gap-4">
                <Skeleton className="h-10 w-10 rounded-full shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-2/3" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <PageHeader
            title="Meeting Notes"
            description="Notes captured from your meetings"
          />
          <Link href="/items/new">
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              New
            </Button>
          </Link>
        </div>
        <EmptyState
          icon={FileText}
          title="No meeting notes yet"
          description="Connect Hedy.ai in Settings to automatically capture and sync your meeting notes."
          action={{ label: "Go to Settings", href: "/settings" }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <PageHeader
          title="Meeting Notes"
          description="Notes captured from your meetings"
        />
        <Link href="/items/new">
          <Button size="sm">
            <Plus className="h-4 w-4 mr-1" />
            New
          </Button>
        </Link>
      </div>

      {groupKeys.map((groupKey) => (
        <div key={groupKey} className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground sticky top-0 bg-background py-2 z-10">
            {groupKey}
          </h2>
          <div className="grid grid-cols-1 gap-3">
            {grouped[groupKey].map((item) => (
              <Link key={item.id} href={`/items/${item.id}`}>
                <Card className="hover:bg-muted/50 transition-colors border-l-4 border-l-transparent hover:border-l-primary group">
                  <CardContent className="p-4 flex items-center gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold truncate group-hover:text-primary transition-colors">
                        {item.title || "Untitled Note"}
                      </h3>
                      {item.content && (
                        <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                          {item.content}
                        </p>
                      )}
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-2">
                        <Clock className="h-3 w-3" />
                        {formatTime(item.created_at)}
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
