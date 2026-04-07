"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ClipboardList, Plus, Settings2, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { TaskList } from "./task-list";
import { RecentMeetings } from "./recent-meetings";
import { AddTaskDialog } from "./add-task-dialog";
import type { TaskEntry, MeetingNote } from "./types";

export function SectionTitle({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2 mb-3">
      <Icon className="h-4 w-4" />
      {title}
    </h3>
  );
}

export function TaskCenter() {
  const [tasks, setTasks] = useState<TaskEntry[]>([]);
  const [meetings, setMeetings] = useState<MeetingNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [tasksRes, meetingsRes] = await Promise.all([
        fetch("/api/memory?category=task"),
        fetch("/api/items?type=meeting_note&limit=5"),
      ]);
      const tasksJson = await tasksRes.json();
      const meetingsJson = await meetingsRes.json();
      if (tasksRes.ok) setTasks(tasksJson.data ?? []);
      if (meetingsRes.ok) setMeetings(meetingsJson.data ?? []);
    } catch {
      toast.error("無法載入任務中心資料");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const addTask = async (content: string, dueDate: Date | undefined): Promise<boolean> => {
    const res = await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: "task", content, importance: 5, dueDate: dueDate?.toISOString() }),
    });
    if (!res.ok) { toast.error("新增任務失敗"); return false; }
    const json = await res.json();
    setTasks((prev) => [json.data, ...prev]);
    toast.success("任務已新增");
    setAddDialogOpen(false);
    return true;
  };

  const deleteTask = async (id: string) => {
    const res = await fetch("/api/memory", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) { toast.error("刪除任務失敗"); return; }
    setTasks((prev) => prev.filter((t) => t.id !== id));
    toast.success("任務已刪除");
  };

  const updateDueDate = async (id: string, dueDate: string | null) => {
    const prev = [...tasks];
    setTasks((t) => t.map((item) => (item.id === id ? { ...item, due_date: dueDate } : item)));
    const res = await fetch("/api/memory", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, due_date: dueDate }),
    });
    if (!res.ok) {
      setTasks(prev);
      toast.error("更新提醒失敗");
      return;
    }
    toast.success(dueDate ? "提醒已設定" : "提醒已清除");
  };

  if (loading) {
    return (
      <Card className="border-primary/10">
        <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
          <Skeleton className="h-6 w-32" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-8" />
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
          <Separator />
          <div className="space-y-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/10">
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-lg flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-primary" />
          任務中心
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setAddDialogOpen(true)} className="h-8">
            <Plus className="h-4 w-4 mr-1" />
            新增
          </Button>
          <Link href="/settings">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <Settings2 className="h-4 w-4 text-muted-foreground" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <TaskList tasks={tasks} onDelete={deleteTask} onUpdateDueDate={updateDueDate} onAdd={() => setAddDialogOpen(true)} />
        {meetings.length > 0 && (
          <>
            <Separator />
            <RecentMeetings meetings={meetings} />
          </>
        )}
      </CardContent>
      <AddTaskDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} onAdd={addTask} />
    </Card>
  );
}
