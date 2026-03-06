import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <p className="text-gray-600">
        Welcome, {user?.user_metadata?.display_name || user?.email}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <a
          href="http://localhost:8000"
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded border border-gray-200 p-4 hover:border-blue-400 transition-colors"
        >
          <h3 className="font-semibold">Supabase Studio</h3>
          <p className="text-sm text-gray-500 mt-1">Database, Auth, Storage</p>
        </a>
        <a
          href="http://localhost:5678"
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded border border-gray-200 p-4 hover:border-blue-400 transition-colors"
        >
          <h3 className="font-semibold">n8n</h3>
          <p className="text-sm text-gray-500 mt-1">Workflow automation</p>
        </a>
        <a
          href="http://localhost:18789"
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded border border-gray-200 p-4 hover:border-blue-400 transition-colors"
        >
          <h3 className="font-semibold">OpenClaw</h3>
          <p className="text-sm text-gray-500 mt-1">AI agent gateway</p>
        </a>
      </div>
    </div>
  );
}
