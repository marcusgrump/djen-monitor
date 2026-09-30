"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ActivityIcon,
  ChevronsUpDownIcon,
  InboxIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MenuIcon,
  RadarIcon,
  SearchIcon,
  SettingsIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth-provider";
import { AvisoIndependente, CarregandoTelaCheia, Logo, SupabaseNaoConfigurado } from "@/components/comum";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

const NAV = [
  { href: "/", rotulo: "Visão geral", icone: LayoutDashboardIcon },
  { href: "/pesquisar/", rotulo: "Pesquisar", icone: SearchIcon },
  { href: "/comunicacoes/", rotulo: "Comunicações", icone: InboxIcon },
  { href: "/monitores/", rotulo: "Monitores", icone: RadarIcon },
  { href: "/execucoes/", rotulo: "Execuções", icone: ActivityIcon },
  { href: "/configuracoes/", rotulo: "Configurações", icone: SettingsIcon },
] as const;

function normalizar(p: string) {
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
}

function NavLinks({ aoNavegar }: { aoNavegar?: () => void }) {
  const pathname = normalizar(usePathname() ?? "/");
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Navegação principal">
      {NAV.map(({ href, rotulo, icone: Icone }) => {
        const alvo = normalizar(href);
        const ativo = alvo === "/" ? pathname === "/" : pathname.startsWith(alvo);
        return (
          <Link
            key={href}
            href={href}
            onClick={aoNavegar}
            aria-current={ativo ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-foreground/80 transition-colors hover:bg-accent hover:text-accent-foreground",
              ativo && "bg-accent text-primary hover:text-primary",
            )}
          >
            <Icone className="size-4 shrink-0" aria-hidden />
            {rotulo}
          </Link>
        );
      })}
    </nav>
  );
}

function MenuUsuario({ lado = "top" }: { lado?: "top" | "bottom" }) {
  const { sessao, sair } = useAuth();
  const router = useRouter();
  const email = sessao?.user.email ?? "";

  const aoSair = async () => {
    await sair();
    toast.success("Você saiu do painel.");
    router.replace("/login/");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" className="h-auto w-full justify-between gap-2 px-2 py-2" />
        }
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-primary uppercase">
            {email.slice(0, 1) || "?"}
          </span>
          <span className="truncate text-left text-sm">{email || "Conta"}</span>
        </span>
        <ChevronsUpDownIcon className="size-4 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent side={lado} align="start" className="min-w-56">
        <DropdownMenuItem variant="destructive" onClick={aoSair}>
          <LogOutIcon /> Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Layout autenticado: guarda de rota + navegação lateral (Sheet no mobile). */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { configurado, carregando, sessao } = useAuth();
  const router = useRouter();
  const [menuAberto, setMenuAberto] = useState(false);

  useEffect(() => {
    if (configurado && !carregando && !sessao) router.replace("/login/");
  }, [configurado, carregando, sessao, router]);

  if (!configurado) {
    return (
      <div className="flex min-h-svh items-center justify-center p-4">
        <div className="w-full max-w-md space-y-4">
          <Logo />
          <SupabaseNaoConfigurado />
        </div>
      </div>
    );
  }

  if (carregando || !sessao) return <CarregandoTelaCheia />;

  return (
    <div className="flex min-h-svh">
      {/* Barra lateral (desktop) */}
      <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col border-r bg-sidebar md:flex">
        <div className="bg-brand px-4 py-4">
          <Link href="/" aria-label="Visão geral">
            <Logo escuro />
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3">
          <NavLinks />
        </div>
        <div className="border-t p-2">
          <MenuUsuario />
        </div>
        <div className="border-t px-4 py-3">
          <AvisoIndependente />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topo (mobile) */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 bg-brand px-4 text-brand-foreground md:hidden">
          <Button
            variant="ghost"
            size="icon"
            className="text-brand-foreground hover:bg-white/10 hover:text-brand-foreground"
            aria-label="Abrir menu"
            onClick={() => setMenuAberto(true)}
          >
            <MenuIcon />
          </Button>
          <Link href="/" className="min-w-0">
            <Logo compacto className="gap-2" />
          </Link>
          <span className="truncate text-sm font-semibold">DJEN Monitor</span>
        </header>

        <Sheet open={menuAberto} onOpenChange={setMenuAberto}>
          <SheetContent side="left" className="w-72 gap-0 p-0">
            <SheetTitle className="sr-only">Menu</SheetTitle>
            <SheetDescription className="sr-only">Navegação do painel</SheetDescription>
            <div className="bg-brand px-4 py-4">
              <Logo escuro />
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-3">
              <NavLinks aoNavegar={() => setMenuAberto(false)} />
            </div>
            <div className="border-t p-2">
              <MenuUsuario />
            </div>
            <div className="border-t px-4 py-3">
              <AvisoIndependente />
            </div>
          </SheetContent>
        </Sheet>

        <main className="mx-auto w-full max-w-6xl min-w-0 flex-1 px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
