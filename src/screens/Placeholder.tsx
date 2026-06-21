import { AppShell } from "@/components/AppShell";
import { Construction } from "lucide-react";

// Écran encore en HTML legacy — migration au fil de l'eau (strangler).
export function Placeholder({ title }: { title: string }) {
  return (
    <AppShell title={title}>
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
        <Construction className="size-9 text-warning" />
        <p className="text-sm">
          <strong className="text-foreground">{title}</strong> — migration vers la nouvelle interface en cours.
        </p>
        <p className="max-w-xs text-xs">
          L'écran <strong>Scoring</strong> est la première vitrine du nouveau design. Les autres suivent un par un.
        </p>
      </div>
    </AppShell>
  );
}
