"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ArrowLeft,
  Trash2,
  Calendar,
  Clock,
  FileText,
  CheckSquare,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";

interface ActionItem {
  text: string;
  assignee?: string;
  done?: boolean;
}

interface Item {
  id: string;
  type: string;
  title: string;
  content: string;
  metadata?: {
    keyPoints?: string[];
    actionItems?: ActionItem[];
    source?: string;
    duration?: string;
  };
  created_at: string;
  updated_at: string;
}

export default function ItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [item, setItem] = useState<Item | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    async function fetchItem() {
      try {
        setLoading(true);
        const res = await fetch(`/api/items/${id}`);
        if (res.status === 404) {
          setNotFound(true);
          return;
        }
        if (!res.ok) return;
        const json = await res.json();
        setItem(json.data);
      } finally {
        setLoading(false);
      }
    }
    fetchItem();
  }, [id]);

  async function handleDelete() {
    try {
      setDeleting(true);
      const res = await fetch(`/api/items/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      toast.success("Meeting note deleted");
      router.push("/items");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete note"
      );
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-10 w-2/3" />
        <div className="flex gap-4">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-5 w-24" />
        </div>
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  if (notFound || !item) {
    return (
      <EmptyState
        icon={AlertCircle}
        title="Meeting note not found"
        description="This note doesn't exist or has been deleted."
        action={{ label: "Back to Meeting Notes", href: "/items" }}
      />
    );
  }

  const formattedDate = new Date(item.created_at).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const formattedTime = new Date(item.created_at).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="space-y-6">
      <Link
        href="/items"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Meeting Notes
      </Link>

      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div className="space-y-2 flex-1 min-w-0">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            {item.title || "Untitled Note"}
          </h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="h-4 w-4" />
              {formattedDate}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-4 w-4" />
              {formattedTime}
            </span>
            {item.metadata?.duration && (
              <span className="text-xs">{item.metadata.duration}</span>
            )}
            <Badge variant="secondary" className="capitalize">
              {item.type.replace("_", " ")}
            </Badge>
          </div>
        </div>

        <Button
          variant="outline"
          size="icon"
          className="text-destructive hover:bg-destructive/10 shrink-0"
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Tabs defaultValue="summary" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="full">Full Content</TabsTrigger>
            </TabsList>

            <TabsContent value="summary" className="mt-4">
              <Card>
                <CardContent className="pt-6">
                  {item.metadata?.keyPoints &&
                  item.metadata.keyPoints.length > 0 ? (
                    <ul className="space-y-3 list-disc pl-5">
                      {item.metadata.keyPoints.map((point, idx) => (
                        <li key={idx} className="leading-relaxed">
                          {point}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="leading-relaxed whitespace-pre-wrap">
                      {item.content
                        ? item.content.substring(0, 500) +
                          (item.content.length > 500 ? "..." : "")
                        : "No content available."}
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="full" className="mt-4">
              <Card>
                <CardContent className="pt-6">
                  <ScrollArea className="h-[500px] pr-4">
                    <p className="leading-relaxed whitespace-pre-wrap">
                      {item.content || "No content available."}
                    </p>
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {item.metadata?.actionItems &&
          item.metadata.actionItems.length > 0 && (
            <Card className="h-fit">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <CheckSquare className="h-5 w-5 text-primary" />
                  Action Items
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {item.metadata.actionItems.map((action, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-3 p-2 rounded-md hover:bg-muted/50 transition-colors"
                  >
                    <div
                      className={`mt-0.5 h-4 w-4 rounded border shrink-0 flex items-center justify-center ${
                        action.done
                          ? "bg-primary border-primary"
                          : "border-muted-foreground"
                      }`}
                    >
                      {action.done && (
                        <svg
                          className="h-3 w-3 text-primary-foreground"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={3}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      )}
                    </div>
                    <div className="space-y-0.5">
                      <p
                        className={`text-sm ${action.done ? "line-through text-muted-foreground" : ""}`}
                      >
                        {action.text}
                      </p>
                      {action.assignee && (
                        <p className="text-xs text-muted-foreground">
                          {action.assignee}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

        {item.metadata?.source && (
          <Card className="h-fit">
            <CardContent className="p-4 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Source</span>
              <Badge variant="outline">{item.metadata.source}</Badge>
            </CardContent>
          </Card>
        )}
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete Meeting Note"
        description="Are you sure you want to delete this meeting note? This action cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
        loading={deleting}
      />
    </div>
  );
}
