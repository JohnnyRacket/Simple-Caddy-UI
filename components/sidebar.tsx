"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { FileCode2, ScrollText, Server, LogOut } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const navItems = [
  { href: "/editor", label: "Editor", icon: FileCode2 },
  { href: "/logs", label: "Logs", icon: ScrollText },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleRevoke() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <aside className="flex flex-col w-14 sm:w-52 shrink-0 border-r border-border bg-card">
      <div className="flex items-center justify-center sm:justify-start px-0 sm:px-4 py-5 border-b border-border h-[52px]">
        <Server className="size-4 shrink-0 sm:hidden text-foreground" />
        <span className="hidden sm:inline text-sm font-semibold tracking-tight text-foreground">
          Caddy UI
        </span>
      </div>
      <TooltipProvider>
        <nav className="flex flex-col gap-1 p-2 flex-1">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Tooltip key={href}>
                <TooltipTrigger asChild>
                  <Link
                    href={href}
                    className={cn(
                      "flex items-center justify-center sm:justify-start gap-2.5 px-0 sm:px-3 py-2 rounded-md text-sm transition-colors",
                      active
                        ? "bg-accent text-accent-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="hidden sm:inline">{label}</span>
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right" className="sm:hidden">
                  {label}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </nav>

        <div className="p-2 border-t border-border">
          <AlertDialog>
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertDialogTrigger
                  className={cn(
                    "flex items-center justify-center sm:justify-start gap-2.5 px-0 sm:px-3 py-2 rounded-md text-sm transition-colors w-full",
                    "text-muted-foreground hover:text-destructive hover:bg-accent/50",
                  )}
                >
                  <LogOut className="size-4 shrink-0" />
                  <span className="hidden sm:inline">Revoke Access</span>
                </AlertDialogTrigger>
              </TooltipTrigger>
              <TooltipContent side="right" className="sm:hidden">
                Revoke Access
              </TooltipContent>
            </Tooltip>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Revoke access?</AlertDialogTitle>
                <AlertDialogDescription>
                  Your session cookie will be cleared and you will be redirected
                  to the login page.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleRevoke}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Revoke
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </TooltipProvider>
    </aside>
  );
}
