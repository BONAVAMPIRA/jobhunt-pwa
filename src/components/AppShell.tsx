import { NavLink } from "react-router-dom";
import { MessageSquare, ClipboardList, Inbox, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

const TABS = [
  { to: "/chat", label: "Chat", icon: MessageSquare },
  { to: "/scoring", label: "Scoring", icon: ClipboardList },
  { to: "/suivi", label: "Suivi", icon: Inbox },
  { to: "/systeme", label: "Système", icon: Settings },
];

export function AppShell({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-[100dvh] flex-col bg-background">
      <header className="flex flex-shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
        <h1 className="text-sm font-semibold text-foreground">{title}</h1>
        <div className="flex items-center gap-2">{actions}</div>
      </header>

      <main className="flex-1 overflow-y-auto">{children}</main>

      <nav className="flex flex-shrink-0 border-t border-border bg-card">
        {TABS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            data-testid={`nav-${label.toLowerCase()}`}
            className={({ isActive }) =>
              cn(
                "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] transition-colors",
                isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )
            }
          >
            <Icon className="size-5" />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
