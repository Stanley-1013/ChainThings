"use client";

import { useState } from "react";
import type { TaskEntry } from "./types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ReminderPopover } from "./reminder-popover";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";

function getDueStatus(dueDate: string | null) {
  if (!dueDate) return { label: "未設定", variant: "secondary" as const, className: "", badgeClass: "text-muted-foreground" };

  const now = new Date();
  const due = new Date(dueDate);
  const diffMs = due.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffMs < 0) {
    return {
      label: `逾期 ${Math.abs(diffDays)} 天`,
      variant: "destructive" as const,
      className: "border-l-2 border-l-destructive bg-destructive/5",
      badgeClass: "",
    };
  }
  if (diffDays <= 1) {
    return {
      label: "今天到期",
      variant: "destructive" as const,
      className: "border-l-2 border-l-destructive bg-destructive/5",
      badgeClass: "",
    };
  }
  if (diffDays <= 3) {
    return {
      label: `${diffDays} 天後到期`,
      variant: "default" as const,
      className: "border-l-2 border-l-amber-500 bg-amber-500/5",
      badgeClass: "bg-amber-500 hover:bg-amber-600 border-transparent text-white",
    };
  }

  const formatted = `${(due.getMonth() + 1).toString().padStart(2, "0")}/${due.getDate().toString().padStart(2, "0")}`;
  return { label: formatted, variant: "outline" as const, className: "", badgeClass: "" };
}

interface TaskItemProps {
  task: TaskEntry;
  onDelete: (id: string) => Promise<void>;
  onUpdateDueDate: (id: string, dueDate: string | null) => Promise<void>;
}

export function TaskItem({ task, onDelete, onUpdateDueDate }: TaskItemProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const status = getDueStatus(task.due_date);

  const handleDelete = async () => {
    setDeleting(true);
    await onDelete(task.id);
    setDeleting(false);
    setDeleteOpen(false);
  };

  return (
    <div
      className={cn(
        "group flex items-center justify-between p-3 rounded-lg border border-border transition-all hover:shadow-sm",
        status.className
      )}
    >
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <p className="text-sm leading-snug">{task.content}</p>
        <Badge variant={status.variant} className={cn("text-[10px] px-1.5 h-4 w-fit", status.badgeClass)}>
          {status.label}
        </Badge>
      </div>

      <div className="flex items-center gap-1 shrink-0 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
        <ReminderPopover
          currentDate={task.due_date ? new Date(task.due_date) : undefined}
          onSelect={(date) => onUpdateDueDate(task.id, date ? date.toISOString() : null)}
        />
        <Button
          variant="ghost"
          size="icon"
          aria-label="刪除任務"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="刪除待辦事項"
        description="確定要刪除這項待辦事項嗎？此動作無法復原。"
        confirmLabel="刪除"
        variant="destructive"
        onConfirm={handleDelete}
        loading={deleting}
      />
    </div>
  );
}
