"use client";

import { AlertTriangleIcon, InboxIcon, Loader2Icon, ScaleIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { STATUS_EXECUCAO_INFO } from "@/lib/constants";
import type { StatusExecucao } from "@/lib/types";

export function Logo({ className, compacto }: { className?: string; compacto?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <ScaleIcon className="size-4.5" aria-hidden />
      </div>
      {!compacto && (
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-tight">DJEN Monitor</div>
          <div className="text-xs text-muted-foreground">Comunicações processuais</div>
        </div>
      )}
    </div>
  );
}

export function PageHeader({
  titulo,
  descricao,
  acoes,
}: {
  titulo: string;
  descricao?: React.ReactNode;
  acoes?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{titulo}</h1>
        {descricao && <p className="mt-1 text-sm text-muted-foreground">{descricao}</p>}
      </div>
      {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
    </div>
  );
}

export function StatusBadge({ status }: { status: StatusExecucao | string }) {
  const info = STATUS_EXECUCAO_INFO[status as StatusExecucao];
  if (!info) return <Badge variant="outline">{status}</Badge>;
  return (
    <Badge variant="secondary" className={cn("gap-1", info.classe)}>
      {status === "executando" && <Loader2Icon className="animate-spin" aria-hidden />}
      {info.rotulo}
    </Badge>
  );
}

export function EstadoVazio({
  titulo,
  descricao,
  icone: Icone = InboxIcon,
  acao,
  className,
}: {
  titulo: string;
  descricao?: React.ReactNode;
  icone?: React.ComponentType<{ className?: string }>;
  acao?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-10 text-center",
        className,
      )}
    >
      <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icone className="size-5" />
      </div>
      <p className="text-sm font-medium">{titulo}</p>
      {descricao && <p className="max-w-sm text-sm text-muted-foreground">{descricao}</p>}
      {acao && <div className="mt-2">{acao}</div>}
    </div>
  );
}

export function ErroCarregamento({
  mensagem,
  aoTentarNovamente,
}: {
  mensagem: string;
  aoTentarNovamente?: () => void;
}) {
  return (
    <Alert variant="destructive">
      <AlertTriangleIcon />
      <AlertTitle>Não foi possível carregar os dados</AlertTitle>
      <AlertDescription>
        <p>{mensagem}</p>
        {aoTentarNovamente && (
          <Button variant="outline" size="sm" className="mt-2" onClick={aoTentarNovamente}>
            Tentar novamente
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

export function SupabaseNaoConfigurado({ className }: { className?: string }) {
  return (
    <Alert className={className}>
      <AlertTriangleIcon />
      <AlertTitle>Supabase não configurado</AlertTitle>
      <AlertDescription>
        <p>
          Defina as variáveis <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_URL</code> e{" "}
          <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> antes do build
          (em <code className="font-mono text-xs">.env.local</code> no desenvolvimento ou nas
          variáveis do workflow de publicação) e gere o site novamente.
        </p>
      </AlertDescription>
    </Alert>
  );
}

export function CarregandoTelaCheia({ texto = "Carregando…" }: { texto?: string }) {
  return (
    <div className="flex min-h-svh items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2Icon className="size-4 animate-spin" aria-hidden />
      {texto}
    </div>
  );
}
