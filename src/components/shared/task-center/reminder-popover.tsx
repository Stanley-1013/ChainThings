"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";

interface ReminderPopoverProps {
  currentDate?: Date;
  onSelect: (date: Date | undefined) => Promise<void>;
}

export function ReminderPopover({ currentDate, onSelect }: ReminderPopoverProps) {
  const [open, setOpen] = useState(false);

  const handleSelect = async (date: Date | undefined) => {
    await onSelect(date);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "inline-flex items-center justify-center h-8 w-8 rounded-lg transition-colors hover:bg-muted",
          currentDate ? "text-primary" : "text-muted-foreground"
        )}
      >
        <Bell className="h-4 w-4" />
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <div className="p-3 border-b flex items-center justify-between">
          <span className="text-sm font-medium">設定提醒日期</span>
          {currentDate && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleSelect(undefined)}
              className="h-7 text-xs px-2 text-destructive hover:text-destructive"
            >
              清除提醒
            </Button>
          )}
        </div>
        <Calendar mode="single" selected={currentDate} onSelect={handleSelect} />
      </PopoverContent>
    </Popover>
  );
}
