"use client";

import { AppSidebar } from "./app-sidebar";
import { MobileHeader } from "./mobile-header";

interface ClientLayoutProps {
  children: React.ReactNode;
  userEmail: string;
}

export function ClientLayout({ children, userEmail }: ClientLayoutProps) {
  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar userEmail={userEmail} />
      <div className="flex-1 flex flex-col md:pl-64">
        <MobileHeader userEmail={userEmail} />
        <main className="flex-1 p-4 md:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
