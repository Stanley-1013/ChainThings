"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface AddTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (content: string, dueDate: Date | undefined) => Promise<boolean>;
}

export function AddTaskDialog({ open, onOpenChange, onAdd }: AddTaskDialogProps) {
  const [content, setContent] = useState("");
  const [dueDate, setDueDate] = useState<Date | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    setSubmitting(true);
    const ok = await onAdd(content, dueDate);
    setSubmitting(false);
    if (ok) {
      setContent("");
      setDueDate(undefined);
    }
  };

  const formatDate = (d: Date) =>
    `${d.getFullYear()}/${(d.getMonth() + 1).toString().padStart(2, "0")}/${d.getDate().toString().padStart(2, "0")}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>新增待辦事項</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="task-content">任務內容</Label>
            <Textarea
              id="task-content"
              placeholder="輸入待辦內容..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="min-h-[100px]"
              required
            />
          </div>
          <div className="space-y-2">
            <Label>到期日期（選填）</Label>
            <Button
              type="button"
              variant="outline"
              className={cn("w-full justify-start text-left font-normal", !dueDate && "text-muted-foreground")}
              onClick={() => setShowCalendar((v) => !v)}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {dueDate ? formatDate(dueDate) : "選擇日期"}
            </Button>
            {showCalendar && (
              <Calendar mode="single" selected={dueDate} onSelect={(d) => { setDueDate(d); setShowCalendar(false); }} />
            )}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!content.trim() || submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              新增任務
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
