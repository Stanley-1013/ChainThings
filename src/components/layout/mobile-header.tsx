"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { SidebarContent } from "./app-sidebar";

export function MobileHeader({ userEmail }: { userEmail: string }) {
  const [open, setOpen] = useState(false);

  return (
    <header className="md:hidden sticky top-0 z-50 flex items-center justify-between p-4 bg-background border-b h-16">
      <h1 className="text-xl font-bold text-primary">ChainThings</h1>
      
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon">
            <Menu className="h-6 w-6" />
            <span className="sr-only">Toggle menu</span>
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="p-0 w-72">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SidebarContent userEmail={userEmail} onItemClick={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </header>
  );
}
