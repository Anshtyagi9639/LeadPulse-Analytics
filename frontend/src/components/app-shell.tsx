"use client";

import {
  Activity,
  BookOpen,
  Copy,
  GitCompareArrows,
  History,
  Download,
  LayoutDashboard,
  Menu,
  Moon,
  PhoneCall,
  ShieldCheck,
  Sparkles,
  Sun,
  Table2,
  Target,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useState } from "react";
import { API_CONFIGURED } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SessionToolbar } from "./session-toolbar";
import { useSession } from "./session-provider";

const NAV = [
  { href: "/", label: "Upload & Map", icon: Upload, step: 1 },
  { href: "/compare", label: "Compare Files", icon: GitCompareArrows, step: 2 },
  { href: "/duplicates", label: "Duplicates", icon: Copy, step: 3 },
  { href: "/quality", label: "Data Quality", icon: ShieldCheck, step: 4 },
  { href: "/spend", label: "Spend & Targets", icon: Target, step: 5 },
  { href: "/contact-report", label: "Contact Report", icon: PhoneCall, step: 6 },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, step: 7 },
  { href: "/leads", label: "Lead Table", icon: Table2, step: 8 },
  { href: "/insights", label: "AI Insights", icon: Sparkles, step: 9 },
  { href: "/exports", label: "Reports & Downloads", icon: Download, step: 10 },
  { href: "/history", label: "Report History", icon: History },
  { href: "/definitions", label: "KPI Definitions", icon: BookOpen },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { session } = useSession();
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Main">
      {NAV.map(({ href, label, icon: Icon, step }) => {
        const active = pathname === href;
        const disabled = !session && !["/", "/definitions", "/history"].includes(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            aria-disabled={disabled}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-sidebar-primary text-sidebar-primary-foreground" : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground",
              disabled && "pointer-events-none opacity-45",
            )}
          >
            <Icon className="size-4" aria-hidden />
            <span className="flex-1">{label}</span>
            {step && <span className={cn("text-xs tabular-nums", active ? "opacity-80" : "text-muted-foreground")}>{step}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 px-3 py-1">
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Activity className="size-4" aria-hidden />
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold">LeadPulse</span>
        <span className="block text-xs text-muted-foreground">Daily KPI reporting</span>
      </span>
    </Link>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button variant="ghost" size="icon-sm" aria-label="Toggle dark mode" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
      <Sun className="hidden size-4 dark:block" />
      <Moon className="size-4 dark:hidden" />
    </Button>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-6 border-r bg-sidebar px-3 py-4 lg:flex">
        <Brand />
        <NavLinks />
        <div className="mt-auto space-y-2 px-3 text-xs text-muted-foreground">
          <p>Temporary reporting tool. Uploaded lead data is deleted when you clear the session or it expires.</p>
          <ThemeToggle />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="flex items-center gap-2 px-4 py-2 lg:hidden">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Open navigation">
                  <Menu className="size-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 bg-sidebar p-4">
                <SheetTitle className="sr-only">Navigation</SheetTitle>
                <div className="flex flex-col gap-6">
                  <Brand />
                  <NavLinks onNavigate={() => setOpen(false)} />
                </div>
              </SheetContent>
            </Sheet>
            <span className="text-sm font-semibold">LeadPulse</span>
            <div className="ml-auto">
              <ThemeToggle />
            </div>
          </div>
          <SessionToolbar />
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 lg:px-8">
          {!API_CONFIGURED && (
            <div role="alert" className="mb-6 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
              <span className="font-medium">Reporting server not configured.</span> This deployment was built without <code>NEXT_PUBLIC_API_URL</code>, so uploads and reports are unavailable. Set it to the HTTPS address of the LeadPulse API and redeploy.
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
