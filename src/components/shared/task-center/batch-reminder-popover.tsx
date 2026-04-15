"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";

interface BatchReminderPopoverProps {
  onSelect: (date: Date | undefined) => Promise<void>;
  disabled?: boolean;
}

export function BatchReminderPopover({ onSelect, disabled }: BatchReminderPopoverProps) {
  const [open, setOpen] = useState(false);

  const handleSelect = async (date: Date | undefined) => {
    await onSelect(date);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="inline-flex items-center justify-center gap-1 h-8 px-3 text-xs rounded-md transition-colors hover:bg-muted disabled:opacity-50"
        disabled={disabled}
      >
        <Bell className="h-4 w-4" />
        提醒
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <div className="p-3 border-b flex items-center justify-between">
          <span className="text-sm font-medium">批量設定提醒</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleSelect(undefined)}
            className="h-7 text-xs px-2 text-destructive hover:text-destructive"
          >
            清除全部
          </Button>
        </div>
        <Calendar mode="single" onSelect={handleSelect} />
      </PopoverContent>
    </Popover>
  );
}
