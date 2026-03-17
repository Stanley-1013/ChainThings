"use client";

import { useState } from "react";
import { ChevronDown, FileText, Brain } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface RagSource {
  id: string;
  title: string | null;
  type: string;
}

interface RagSourcesProps {
  sources: RagSource[];
}

export function RagSources({ sources }: RagSourcesProps) {
  const [expanded, setExpanded] = useState(false);

  if (!sources.length) return null;

  return (
    <div className="mt-1.5">
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronDown
          className={cn(
            "h-3 w-3 transition-transform",
            expanded && "rotate-180"
          )}
        />
        {sources.length} source{sources.length !== 1 ? "s" : ""} cited
      </button>
      {expanded && (
        <div className="mt-1.5 space-y-1 animate-in fade-in slide-in-from-top-1">
          {sources.map((source) => (
            <div
              key={source.id}
              className="flex items-center gap-2 text-xs text-muted-foreground px-2 py-1 rounded bg-muted/50"
            >
              {source.type === "memory" ? (
                <Brain className="h-3 w-3 shrink-0" />
              ) : (
                <FileText className="h-3 w-3 shrink-0" />
              )}
              <span className="truncate">
                {source.title || "Untitled"}
              </span>
              <Badge variant="outline" className="ml-auto h-4 text-[10px] px-1">
                {source.type}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
