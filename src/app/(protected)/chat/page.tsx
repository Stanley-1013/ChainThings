import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function ChatListPage() {
  const supabase = await createClient();

  const { data: conversations } = await supabase
    .from("chainthings_conversations")
    .select("id, title, updated_at")
    .order("updated_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Chat</h1>
        <Link
          href="/chat/new"
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          New conversation
        </Link>
      </div>

      {conversations && conversations.length > 0 ? (
        <div className="space-y-2">
          {conversations.map((conv) => (
            <Link
              key={conv.id}
              href={`/chat/${conv.id}`}
              className="block rounded border border-gray-200 p-4 hover:border-blue-400 transition-colors"
            >
              <h3 className="font-medium">{conv.title}</h3>
              <p className="text-xs text-gray-500 mt-1">
                {new Date(conv.updated_at).toLocaleString()}
              </p>
            </Link>
          ))}
        </div>
      ) : (
        <p className="text-gray-500">
          No conversations yet. Start a new one!
        </p>
      )}
    </div>
  );
}
