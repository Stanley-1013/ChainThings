"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FileText,
  Upload,
  Loader2,
  Sparkles,
  ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

export default function NewMeetingNotePage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  async function handleSave(autoExtract = false) {
    if (!content.trim()) {
      toast.error("Please enter some content");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "meeting_note",
          title: title || "Untitled Note",
          content,
          metadata: {},
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error);

      const itemId = json.data.id;

      if (autoExtract) {
        setExtracting(true);
        try {
          const extractRes = await fetch("/api/items/extract", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ itemId }),
          });
          if (!extractRes.ok) {
            const extractJson = await extractRes.json();
            toast.error(`Extract failed: ${extractJson.error}`);
          } else {
            toast.success("Note saved and analyzed!");
          }
        } catch {
          toast.error("Note saved but AI analysis failed");
        } finally {
          setExtracting(false);
        }
      } else {
        toast.success("Meeting note saved!");
      }

      // Trigger embedding in background
      fetch("/api/rag/embed", { method: "POST" }).catch(() => {});

      router.push(`/items/${itemId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleFileUpload() {
    if (!uploadFile) return;

    setSaving(true);
    try {
      const text = await uploadFile.text();
      setContent(text);
      setTitle(uploadFile.name.replace(/\.[^.]+$/, ""));
      toast.success("File loaded! You can edit before saving.");
    } catch {
      toast.error("Failed to read file");
    } finally {
      setSaving(false);
    }
  }

  const isProcessing = saving || extracting;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/items">
          <Button variant="ghost" size="icon" className="shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <PageHeader
          title="New Meeting Note"
          description="Add a meeting transcript or notes"
        />
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="note-title">Title</Label>
          <Input
            id="note-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Meeting title (optional, AI can generate)"
          />
        </div>

        <Tabs defaultValue="text" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="text" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Text Input
            </TabsTrigger>
            <TabsTrigger value="upload" className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              File Upload
            </TabsTrigger>
          </TabsList>

          <TabsContent value="text" className="mt-4">
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Paste your meeting transcript or notes here..."
              className="min-h-[300px] resize-y"
            />
          </TabsContent>

          <TabsContent value="upload" className="mt-4">
            <Card className="border-dashed">
              <CardContent className="pt-6">
                <div className="flex flex-col items-center gap-4 py-8">
                  <Upload className="h-10 w-10 text-muted-foreground" />
                  <div className="text-center">
                    <p className="text-sm font-medium">
                      Upload a text file
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Supports .txt, .md files
                    </p>
                  </div>
                  <input
                    type="file"
                    accept=".txt,.md,.text"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) setUploadFile(file);
                    }}
                    className="text-sm"
                  />
                  {uploadFile && (
                    <Button onClick={handleFileUpload} disabled={isProcessing}>
                      {saving ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : null}
                      Load File Content
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {content && (
              <div className="mt-4">
                <Label>Loaded Content Preview</Label>
                <Textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="min-h-[200px] resize-y mt-2"
                />
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <div className="flex gap-3 pt-2">
        <Button
          onClick={() => handleSave(false)}
          disabled={isProcessing || !content.trim()}
          variant="secondary"
        >
          {saving && !extracting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : null}
          Save Only
        </Button>
        <Button
          onClick={() => handleSave(true)}
          disabled={isProcessing || !content.trim()}
        >
          {isProcessing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-2 h-4 w-4" />
          )}
          {extracting ? "Analyzing..." : "Save & Analyze with AI"}
        </Button>
      </div>
    </div>
  );
}
