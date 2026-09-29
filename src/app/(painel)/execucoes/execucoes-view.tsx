"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ActivityIcon, ChevronLeftIcon, ChevronRightIcon, RefreshCwIcon } from "lucide-react";
import { EstadoVazio, ErroCarregamento, PageHeader } from "@/components/comum";
import { DetalhesExecucao, TabelaExecucoes } from "@/components/execucoes";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useIntervalo, useQuery } from "@/hooks/use-query";
import { useSincronizar } from "@/hooks/use-sincronizar";
import { TAMANHO_PAGINA } from "@/lib/constants";
import { formatarDataHora, formatarNumero } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { Monitor, SyncExecucao } from "@/lib/types";
import { cn } from "@/lib/utils";

const ITENS_STATUS = [
  { value: "", label: "Todos os status" },
  { value: "executando", label: "Executando" },
  { value: "sucesso", label: "Sucesso" },
  { value: "parcial", label: "Parcial" },
  { value: "erro", label: "Erro" },
];
const ITENS_ORIGEM = [
  { value: "", label: "Todas as origens" },
  { value: "cron", label: "Automática" },
  { value: "manual", label: "Manual" },
];

async function buscarExecucoes(status: string, origem: string, pagina: number) {
  let q = supabase().from("sync_execucoes").select("*", { count: "exact" });
  if (status) q = q.eq("status", status);
  if (origem) q = q.eq("origem", origem);
  const inicio = (pagina - 1) * TAMANHO_PAGINA;
  const { data, error, count } = await q
    .order("iniciada_em", { ascending: false })
    .range(inicio, inicio + TAMANHO_PAGINA - 1);
  if (error) {
    if (error.code === "PGRST103") return { linhas: [] as SyncExecucao[], total: count ?? 0 };
    throw error;
  }
  return { linhas: (data ?? []) as SyncExecucao[], total: count ?? 0 };
}

async function buscarMonitoresNomes() {
  const { data, error } = await supabase().from("monitores").select("id,nome");
  if (error) throw error;
  return (data ?? []) as Pick<Monitor, "id" | "nome">[];
}

async function buscarExecucao(id: number) {
  const { data, error } = await supabase().from("sync_execucoes").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as SyncExecucao | null) ?? null;
}

export function ExecucoesView() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const status = ITENS_STATUS.some((i) => i.value === sp.get("status")) ? (sp.get("status") as string) : "";
  const origem = ITENS_ORIGEM.some((i) => i.value === sp.get("origem")) ? (sp.get("origem") as string) : "";
  const paginaBruta = Number.parseInt(sp.get("pagina") ?? "1", 10);
  const pagina = Number.isFinite(paginaBruta) && paginaBruta > 0 ? paginaBruta : 1;
  const idAberto = /^\d+$/.test(sp.get("id") ?? "") ? Number(sp.get("id")) : null;

  const atualizarUrl = useCallback(
    (mudancas: Record<string, string | null>) => {
      const p = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(mudancas)) {
        if (v === null || v === "") p.delete(k);
        else p.set(k, v);
      }
      if (!("pagina" in mudancas) && !("id" in mudancas)) p.delete("pagina");
      const qs = p.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, sp],
  );

  const lista = useQuery(`execucoes:${status}:${origem}:${pagina}`, () =>
    buscarExecucoes(status, origem, pagina),
  );
  const monitores = useQuery("execucoes:monitores", buscarMonitoresNomes);
  const { executando, executar } = useSincronizar(lista.recarregar);

  const linhas = lista.dados?.linhas ?? [];
  const total = lista.dados?.total ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / TAMANHO_PAGINA));
  const algumaExecutando = linhas.some((l) => l.status === "executando");
  useIntervalo(lista.recarregar, 10_000, algumaExecutando && executando === null);

  const selecionadaNaLista = linhas.find((l) => l.id === idAberto) ?? null;
  const avulsa = useQuery(
    idAberto !== null && !selecionadaNaLista && !lista.carregandoInicial ? `execucao:${idAberto}` : null,
    () => buscarExecucao(idAberto as number),
  );
  const selecionada = selecionadaNaLista ?? avulsa.dados ?? null;

  return (
    <div className="space-y-5">
      <PageHeader
        titulo="Execuções"
        descricao="Histórico completo das sincronizações com a API do DJEN."
        acoes={
          <>
            <Button
              variant="outline"
              size="icon"
              onClick={lista.recarregar}
              aria-label="Atualizar"
              disabled={lista.carregando}
            >
              <RefreshCwIcon className={cn(lista.carregando && "animate-spin")} />
            </Button>
            <Button onClick={() => executar()} disabled={executando !== null || algumaExecutando}>
              <RefreshCwIcon className={cn(executando !== null && "animate-spin")} />
              {executando !== null ? "Sincronizando…" : "Sincronizar agora"}
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap gap-2">
        <Select items={ITENS_STATUS} value={status} onValueChange={(v) => atualizarUrl({ status: (v as string | null) || null })}>
          <SelectTrigger className="w-44" aria-label="Filtrar por status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ITENS_STATUS.map((i) => (
              <SelectItem key={i.value || "todos"} value={i.value}>
                {i.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select items={ITENS_ORIGEM} value={origem} onValueChange={(v) => atualizarUrl({ origem: (v as string | null) || null })}>
          <SelectTrigger className="w-44" aria-label="Filtrar por origem">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ITENS_ORIGEM.map((i) => (
              <SelectItem key={i.value || "todas"} value={i.value}>
                {i.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {lista.erro && <ErroCarregamento mensagem={lista.erro} aoTentarNovamente={lista.recarregar} />}

      <Card className={cn("gap-0 py-0", !lista.dados && lista.erro && "hidden")}>
        {lista.carregandoInicial ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : linhas.length === 0 && lista.erro ? null : linhas.length === 0 ? (
          <div className="p-4">
            <EstadoVazio
              icone={ActivityIcon}
              titulo={status || origem ? "Nenhuma execução com esses filtros" : "Nenhuma execução registrada"}
              descricao="As sincronizações automáticas rodam a cada 30 minutos; você também pode disparar uma manualmente."
            />
          </div>
        ) : (
          <div className={cn("[&_td:first-child]:pl-4 [&_th:first-child]:pl-4", lista.carregando && "opacity-60")}>
            <TabelaExecucoes execucoes={linhas} aoSelecionar={(e) => atualizarUrl({ id: String(e.id) })} />
          </div>
        )}
        {total > 0 && (
          <div className="flex flex-col items-center justify-between gap-2 border-t px-4 py-3 text-sm sm:flex-row">
            <span className="text-muted-foreground tabular-nums">
              {formatarNumero(total)} {total === 1 ? "execução" : "execuções"}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={pagina <= 1 || lista.carregando}
                onClick={() => atualizarUrl({ pagina: pagina - 1 > 1 ? String(pagina - 1) : null })}
              >
                <ChevronLeftIcon /> Anterior
              </Button>
              <span className="px-1 text-muted-foreground tabular-nums">
                {formatarNumero(pagina)} / {formatarNumero(totalPaginas)}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={pagina >= totalPaginas || lista.carregando}
                onClick={() => atualizarUrl({ pagina: String(pagina + 1) })}
              >
                Próxima <ChevronRightIcon />
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Sheet open={idAberto !== null} onOpenChange={(v) => !v && atualizarUrl({ id: null })}>
        <SheetContent side="right" className="w-full gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
          <SheetHeader className="border-b pr-12">
            <SheetTitle>Execução #{idAberto}</SheetTitle>
            <SheetDescription>
              {selecionada ? `Iniciada em ${formatarDataHora(selecionada.iniciada_em)}` : "Carregando…"}
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-4">
            {selecionada ? (
              <DetalhesExecucao execucao={selecionada} monitores={monitores.dados ?? []} />
            ) : avulsa.erro ? (
              <ErroCarregamento mensagem={avulsa.erro} aoTentarNovamente={avulsa.recarregar} />
            ) : !avulsa.carregando && avulsa.dados === null ? (
              <p className="text-sm text-muted-foreground">Execução não encontrada.</p>
            ) : (
              <div className="space-y-3">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-40 w-full" />
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
