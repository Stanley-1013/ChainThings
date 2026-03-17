"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Copy, Check, Zap } from "lucide-react";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function CodeBlock({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const code = String(children).replace(/\n$/, "");

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group/code my-3">
      <button
        onClick={handleCopy}
        className="absolute right-2 top-2 p-1.5 rounded-md bg-muted/80 opacity-0 group-hover/code:opacity-100 transition-opacity hover:bg-muted"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-500" />
        ) : (
          <Copy className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>
      <pre className="overflow-x-auto rounded-lg border bg-muted/50 p-4 text-sm">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

function N8nWorkflowBlock() {
  return (
    <Card className="my-3 border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/30 shadow-sm overflow-hidden">
      <CardContent className="p-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-green-100 dark:bg-green-900 rounded-md">
            <Zap className="h-4 w-4 text-green-600 dark:text-green-400" />
          </div>
          <span className="text-sm font-semibold text-green-700 dark:text-green-300">
            Workflow JSON generated
          </span>
        </div>
        <Badge
          variant="outline"
          className="bg-white dark:bg-green-900/50 text-green-700 dark:text-green-300 border-green-200 dark:border-green-700"
        >
          Ready
        </Badge>
      </CardContent>
    </Card>
  );
}

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  // Pre-process: extract n8n-workflow blocks and replace with placeholders
  const n8nBlocks: string[] = [];
  const processed = content.replace(
    /```n8n-workflow[\s\S]*?```/g,
    () => {
      const idx = n8nBlocks.length;
      n8nBlocks.push("n8n");
      return `\n<!--n8n-block-${idx}-->\n`;
    }
  );

  // Split on n8n placeholders
  const segments = processed.split(/(<!--n8n-block-\d+-->)/);

  return (
    <div className={cn("space-y-0", className)}>
      {segments.map((segment, i) => {
        const n8nMatch = segment.match(/<!--n8n-block-(\d+)-->/);
        if (n8nMatch) {
          return <N8nWorkflowBlock key={i} />;
        }
        if (!segment.trim()) return null;
        return (
          <div key={i} className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1.5 prose-headings:my-2 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-pre:p-0 prose-pre:bg-transparent prose-pre:border-0 prose-code:before:content-none prose-code:after:content-none prose-a:text-primary prose-table:text-sm">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={{
              code({ className: codeClassName, children, ...props }) {
                const isBlock =
                  typeof children === "string" && children.includes("\n");
                if (isBlock || codeClassName) {
                  return (
                    <CodeBlock className={codeClassName}>{children}</CodeBlock>
                  );
                }
                return (
                  <code
                    className="rounded bg-muted px-1.5 py-0.5 text-sm font-mono"
                    {...props}
                  >
                    {children}
                  </code>
                );
              },
              pre({ children }) {
                return <>{children}</>;
              },
              a({ href, children }) {
                return (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline underline-offset-2 hover:text-primary/80"
                  >
                    {children}
                    <span className="sr-only"> (opens in new window)</span>
                  </a>
                );
              },
              table({ children }) {
                return (
                  <div className="my-3 overflow-x-auto rounded-lg border">
                    <table className="w-full text-sm">{children}</table>
                  </div>
                );
              },
              th({ children }) {
                return (
                  <th className="border-b bg-muted/50 px-3 py-2 text-left font-medium">
                    {children}
                  </th>
                );
              },
              td({ children }) {
                return (
                  <td className="border-b px-3 py-2">{children}</td>
                );
              },
            }}
          >
            {segment}
          </ReactMarkdown>
          </div>
        );
      })}
    </div>
  );
}
