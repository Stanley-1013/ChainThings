import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ClientLayout } from "@/components/layout/client-layout";

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
    <ClientLayout userEmail={user.email || ""}>
      {children}
    </ClientLayout>
  );
}
