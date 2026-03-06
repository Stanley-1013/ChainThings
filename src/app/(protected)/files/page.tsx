"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useState, useCallback } from "react";

interface FileMeta {
  id: string;
  filename: string;
  content_type: string | null;
  size_bytes: number | null;
  created_at: string;
}

export default function FilesPage() {
  const [files, setFiles] = useState<FileMeta[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  const loadFiles = useCallback(async () => {
    const { data } = await supabase
      .from("chainthings_files")
      .select("id, filename, content_type, size_bytes, created_at")
      .order("created_at", { ascending: false });

    if (data) setFiles(data);
  }, []);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/files/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Upload failed");
      }

      await loadFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  function formatSize(bytes: number | null) {
    if (!bytes) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Files</h1>
        <label className="cursor-pointer rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          {uploading ? "Uploading..." : "Upload file"}
          <input
            type="file"
            onChange={handleUpload}
            disabled={uploading}
            className="hidden"
          />
        </label>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {files.length > 0 ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-gray-500">
              <th className="py-2">Name</th>
              <th className="py-2">Type</th>
              <th className="py-2">Size</th>
              <th className="py-2">Uploaded</th>
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.id} className="border-b">
                <td className="py-2 font-medium">{f.filename}</td>
                <td className="py-2 text-gray-500">{f.content_type || "—"}</td>
                <td className="py-2 text-gray-500">{formatSize(f.size_bytes)}</td>
                <td className="py-2 text-gray-500">
                  {new Date(f.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-gray-500">No files uploaded yet.</p>
      )}
    </div>
  );
}
