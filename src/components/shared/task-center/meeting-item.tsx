"use client";

import { useState } from "react";
import type { MeetingNote } from "./types";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

interface MeetingItemProps {
  meeting: MeetingNote;
}

export function MeetingItem({ meeting }: MeetingItemProps) {
  const [isOpen, setIsOpen] = useState(false);
  const actionItemsCount = meeting.metadata?.actionItems?.length ?? 0;
  const keyPoints = meeting.metadata?.keyPoints ?? [];
  const recap = meeting.metadata?.summary || meeting.metadata?.recap || "";

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${(d.getMonth() + 1).toString().padStart(2, "0")}/${d.getDate().toString().padStart(2, "0")}`;
  };

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className="border rounded-lg overflow-hidden transition-all hover:border-primary/20"
    >
      <div className="flex items-center p-3 gap-3">
        <CollapsibleTrigger
          className="flex items-center justify-center h-8 w-8 rounded-full hover:bg-muted transition-colors shrink-0"
        >
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform duration-200", isOpen && "rotate-180")} />
        </CollapsibleTrigger>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <Link
              href={`/items/${meeting.id}`}
              className="text-sm font-medium truncate hover:text-primary hover:underline flex items-center gap-1.5"
            >
              {meeting.title || "無標題記錄"}
              <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />
            </Link>
            <span className="text-[10px] text-muted-foreground shrink-0">
              {formatDate(meeting.created_at)}
            </span>
          </div>
          {actionItemsCount > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1.5 h-4 mt-1">
              {actionItemsCount} 個待辦
            </Badge>
          )}
        </div>
      </div>

      <CollapsibleContent>
        <div className="px-3 pb-3 ml-11 border-t pt-2">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">摘要</p>
          {keyPoints.length > 0 ? (
            <ul className="list-disc list-inside space-y-1">
              {keyPoints.map((point, i) => (
                <li key={i} className="text-xs text-muted-foreground leading-relaxed">{point}</li>
              ))}
            </ul>
          ) : recap ? (
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4">{recap}</p>
          ) : (
            <p className="text-xs text-muted-foreground italic">無摘要內容</p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
