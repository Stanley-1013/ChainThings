"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  LayoutDashboard, 
  MessageSquare, 
  FolderOpen, 
  Zap, 
  FileText, 
  Settings2,
  LogOut,
  User
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

const navItems = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Chat", href: "/chat", icon: MessageSquare },
  { name: "Files", href: "/files", icon: FolderOpen },
  { name: "Workflows", href: "/workflows", icon: Zap },
  { name: "Meeting Notes", href: "/items", icon: FileText },
  { name: "Settings", href: "/settings", icon: Settings2 },
];

interface SidebarProps {
  userEmail: string;
  onItemClick?: () => void;
}

export function SidebarContent({ userEmail, onItemClick }: SidebarProps) {
  const pathname = usePathname();

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="p-6">
        <h1 className="text-xl font-bold text-primary">ChainThings</h1>
      </div>

      <nav className="flex-1 px-4 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          const Icon = item.icon;

          return (
            <div key={item.name}>
              {item.name === "Settings" && <Separator className="my-2" />}
              <Link
                href={item.href}
                onClick={onItemClick}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors",
                  isActive 
                    ? "bg-primary/10 text-primary font-semibold border-l-2 border-primary rounded-l-none -ml-4 pl-7" 
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {item.name}
              </Link>
            </div>
          );
        })}
      </nav>

      <div className="p-4 mt-auto">
        <div className="flex items-center gap-3 px-2 py-3 mb-2">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-primary/10 text-primary">
              <User className="h-4 w-4" />
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 overflow-hidden">
            <p className="text-sm font-medium truncate">{userEmail}</p>
          </div>
        </div>
        <form action="/api/auth/signout" method="POST">
          <Button variant="ghost" className="w-full justify-start gap-3 text-muted-foreground hover:text-destructive" type="submit">
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </form>
      </div>
    </div>
  );
}

export function AppSidebar({ userEmail }: { userEmail: string }) {
  return (
    <aside className="hidden md:flex w-64 flex-col fixed inset-y-0 border-r z-50">
      <SidebarContent userEmail={userEmail} />
    </aside>
  );
}
