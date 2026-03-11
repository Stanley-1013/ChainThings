"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useState, useCallback, useRef } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuLabel, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  FileIcon, 
  Upload, 
  MoreVertical, 
  Download, 
  Trash2, 
  FileText, 
  ImageIcon, 
  Film, 
  Music, 
  Loader2 
} from "lucide-react";
import { toast } from "sonner";

interface FileMeta {
  id: string;
  filename: string;
  content_type: string | null;
  size_bytes: number | null;
  created_at: string;
  storage_path: string;
}

export default function FilesPage() {
  const [files, setFiles] = useState<FileMeta[]>([]);
  const [uploading, setUploading] = useState(false);
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadFiles = useCallback(async () => {
    const { data } = await supabase
      .from("chainthings_files")
      .select("id, filename, content_type, size_bytes, created_at, storage_path")
      .order("created_at", { ascending: false });

    if (data) setFiles(data as FileMeta[]);
  }, []);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const toastId = toast.loading(`Uploading ${file.name}...`);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/files/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Upload failed");
      }

      toast.success(`${file.name} uploaded successfully`, { id: toastId });
      await loadFiles();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed", { id: toastId });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function formatSize(bytes: number | null) {
    if (!bytes) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function getFileIcon(contentType: string | null) {
    if (!contentType) return <FileIcon className="h-4 w-4" />;
    if (contentType.startsWith("image/")) return <ImageIcon className="h-4 w-4" />;
    if (contentType.startsWith("video/")) return <Film className="h-4 w-4" />;
    if (contentType.startsWith("audio/")) return <Music className="h-4 w-4" />;
    if (contentType.includes("pdf") || contentType.includes("text")) return <FileText className="h-4 w-4" />;
    return <FileIcon className="h-4 w-4" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Files" description="Manage your documents and assets">
        <Button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
          {uploading ? "Uploading..." : "Upload file"}
        </Button>
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleUpload}
          disabled={uploading}
          className="hidden"
        />
      </PageHeader>

      {files.length > 0 ? (
        <>
          {/* Desktop View */}
          <div className="hidden md:block border rounded-lg overflow-hidden bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40%]">Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-primary/5 text-primary rounded-md">
                          {getFileIcon(f.content_type)}
                        </div>
                        <span className="truncate max-w-[200px] lg:max-w-md">{f.filename}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-normal text-[10px] uppercase">
                        {f.content_type?.split("/")[1] || "unknown"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatSize(f.size_bytes)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(f.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Actions</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem>
                            <Download className="mr-2 h-4 w-4" /> Download
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive focus:text-destructive">
                            <Trash2 className="mr-2 h-4 w-4" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile View */}
          <div className="grid grid-cols-1 gap-3 md:hidden">
            {files.map((f) => (
              <Card key={f.id}>
                <CardContent className="p-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2 bg-primary/5 text-primary rounded-md shrink-0">
                      {getFileIcon(f.content_type)}
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-sm font-medium truncate">{f.filename}</h4>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-muted-foreground">{formatSize(f.size_bytes)}</span>
                        <span className="text-[10px] text-muted-foreground">•</span>
                        <span className="text-xs text-muted-foreground">{new Date(f.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem>
                        <Download className="mr-2 h-4 w-4" /> Download
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive">
                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      ) : (
        <EmptyState 
          icon={FileIcon}
          title="No files yet"
          description="Upload documents or assets to store them securely and use them in your workflows."
          action={{
            label: "Upload file",
            onClick: () => fileInputRef.current?.click()
          }}
        />
      )}
    </div>
  );
}
