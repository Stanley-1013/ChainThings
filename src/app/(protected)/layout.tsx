import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 border-r border-gray-200 p-4 space-y-2">
        <h2 className="text-lg font-bold mb-4">ChainThings</h2>
        <nav className="space-y-1">
          <Link
            href="/dashboard"
            className="block rounded px-3 py-2 text-sm hover:bg-gray-100"
          >
            Dashboard
          </Link>
          <Link
            href="/chat"
            className="block rounded px-3 py-2 text-sm hover:bg-gray-100"
          >
            Chat
          </Link>
          <Link
            href="/files"
            className="block rounded px-3 py-2 text-sm hover:bg-gray-100"
          >
            Files
          </Link>
          <Link
            href="/workflows"
            className="block rounded px-3 py-2 text-sm hover:bg-gray-100"
          >
            Workflows
          </Link>
          <Link
            href="/settings"
            className="block rounded px-3 py-2 text-sm hover:bg-gray-100"
          >
            Settings
          </Link>
        </nav>
        <div className="pt-4 border-t border-gray-200 mt-4">
          <p className="text-xs text-gray-500 truncate">{user.email}</p>
          <form action="/api/auth/signout" method="POST">
            <button
              type="submit"
              className="mt-2 text-xs text-red-600 hover:underline"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
