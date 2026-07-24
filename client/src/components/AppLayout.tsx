import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  BadgeCheck,
  Columns3,
  Database,
  FileSpreadsheet,
  FileUp,
  FolderUp,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Radar,
  Settings,
  ShieldCheck,
  Languages,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  labelKey: string;
  icon: ReactNode;
}

const NAV: NavItem[] = [
  { href: "/coverage", labelKey: "nav.coverage", icon: <LayoutDashboard className="h-4 w-4" /> },
  { href: "/ingest", labelKey: "nav.ingest", icon: <FileSpreadsheet className="h-4 w-4" /> },
  { href: "/assets", labelKey: "nav.assets", icon: <Database className="h-4 w-4" /> },
  { href: "/attributes", labelKey: "nav.attributes", icon: <Columns3 className="h-4 w-4" /> },
  { href: "/detection", labelKey: "nav.detection", icon: <Radar className="h-4 w-4" /> },
  { href: "/classification", labelKey: "nav.classification", icon: <BadgeCheck className="h-4 w-4" /> },
  { href: "/review", labelKey: "nav.review", icon: <ListChecks className="h-4 w-4" /> },
  { href: "/import", labelKey: "nav.import", icon: <FileUp className="h-4 w-4" /> },
  { href: "/settings", labelKey: "nav.settings", icon: <Settings className="h-4 w-4" /> },
  { href: "/import-test", labelKey: "nav.importTest", icon: <FolderUp className="h-4 w-4" /> },
];

export function AppLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { t, lang, toggle } = useLanguage();

  const isActive = (href: string) =>
    location === href || (href === "/coverage" && location === "/");

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="flex w-64 flex-col border-e bg-card">
        <div className="flex items-center gap-2 border-b px-5 py-4">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-primary text-primary-foreground">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold">{t("app.short")}</p>
            <p className="text-xs text-muted-foreground">{t("app.org")}</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {NAV.filter((item) => item.href !== "/settings" || user?.role === "admin").map((item) => (
            <Link key={item.href} href={item.href}>
              <span
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive(item.href)
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                {item.icon}
                {t(item.labelKey)}
              </span>
            </Link>
          ))}
        </nav>

        <div className="space-y-2 border-t p-3">
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={toggle}>
            <Languages className="h-4 w-4" />
            {lang === "en" ? "العربية" : "English"}
          </Button>
          <div className="flex items-center justify-between rounded-md px-3 py-2 text-sm">
            <div className="truncate">
              <p className="font-medium">{user?.username}</p>
              <p className="text-xs text-muted-foreground">{user?.role}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={() => logout()} title={t("action.logout")}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-x-hidden">
        <div className="mx-auto max-w-7xl p-6">{children}</div>
      </main>
    </div>
  );
}
