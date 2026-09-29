"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  Loader2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  RadarIcon,
  RefreshCwIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { EstadoVazio, ErroCarregamento, PageHeader } from "@/components/comum";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAgora, useQuery } from "@/hooks/use-query";
import { useSincronizar } from "@/hooks/use-sincronizar";
import { filtrosDeQuery, filtrosParaQuery, normalizadosDeMonitor, partesResumo } from "@/lib/filtros";
import { formatarDataHora, formatarNumero, hojeISO, tempoRelativo } from "@/lib/format";
import { mensagemErro, supabase } from "@/lib/supabase";
import type { Monitor } from "@/lib/types";
import { cn } from "@/lib/utils";
import { MonitorFormDialog } from "./monitor-form";
import { formDeFiltros, type MonitorForm } from "./monitor-schema";

type MonitorComContagem = Monitor & { monitor_comunicacoes: { count: number }[] };

async function buscarMonitores() {
  const { data, error } = await supabase()
    .from("monitores")
    .select("*, monitor_comunicacoes(count)")
    .order("ativo", { ascending: false })
    .order("nome");
  if (error) throw error;
  return (data ?? []) as MonitorComContagem[];
}

/** Link para a página Pesquisar com os filtros do monitor e o período das sincronizações. */
export function linkTestarNaPesquisa(m: Monitor) {
  const sp = filtrosParaQuery(normalizadosDeMonitor(m));
  sp.set("de", hojeISO(-Math.max(0, m.dias_retroativos)));
  sp.set("ate", hojeISO());
  return `/pesquisar/?${sp.toString()}`;
}

export function MonitoresView() {
  const { dados, erro, carregandoInicial, carregando, recarregar } = useQuery("monitores", buscarMonitores);
  const { executando, executar } = useSincronizar(recarregar);
  const agora = useAgora();
  const router = useRouter();
  const searchParams = useSearchParams();

  // "Criar monitor com estes filtros" (página Pesquisar) chega como /monitores/?novo=1&<filtros>.
  const [prefill] = useState<MonitorForm | null>(() =>
    searchParams.get("novo") === "1"
      ? formDeFiltros(filtrosDeQuery(new URLSearchParams(searchParams.toString())))
      : null,
  );
  const [inicial, setInicial] = useState<MonitorForm | null>(prefill);
  useEffect(() => {
    if (searchParams.get("novo") === "1") router.replace("/monitores/", { scroll: false });
  }, [router, searchParams]);

  const [formAberto, setFormAberto] = useState(prefill !== null);
  const [editando, setEditando] = useState<Monitor | null>(null);
  const [excluindo, setExcluindo] = useState<Monitor | null>(null);
  const [processandoExclusao, setProcessandoExclusao] = useState(false);
  const [alternando, setAlternando] = useState<number | null>(null);

  const [versaoForm, setVersaoForm] = useState(0);

  const novo = () => {
    setEditando(null);
    setInicial(null);
    setVersaoForm((v) => v + 1);
    setFormAberto(true);
  };
  const editar = (m: Monitor) => {
    setEditando(m);
    setVersaoForm((v) => v + 1);
    setFormAberto(true);
  };

  const alternarAtivo = async (m: Monitor, ativo: boolean) => {
    setAlternando(m.id);
    const { error } = await supabase().from("monitores").update({ ativo }).eq("id", m.id);
    setAlternando(null);
    if (error) {
      toast.error("Não foi possível atualizar", { description: mensagemErro(error) });
      return;
    }
    toast.success(ativo ? `“${m.nome}” ativado.` : `“${m.nome}” pausado.`);
    recarregar();
  };

  const excluir = async () => {
    if (!excluindo) return;
    setProcessandoExclusao(true);
    const { error } = await supabase().from("monitores").delete().eq("id", excluindo.id);
    setProcessandoExclusao(false);
    if (error) {
      toast.error("Não foi possível excluir", { description: mensagemErro(error) });
      return;
    }
    toast.success(`Monitor “${excluindo.nome}” excluído.`);
    setExcluindo(null);
    recarregar();
  };

  const monitores = dados ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        titulo="Monitores"
        descricao="O que o DJEN Monitor procura a cada sincronização."
        acoes={
          <>
            <Button variant="outline" size="icon" onClick={recarregar} aria-label="Atualizar" disabled={carregando}>
              <RefreshCwIcon className={cn(carregando && "animate-spin")} />
            </Button>
            <Button onClick={novo}>
              <PlusIcon /> Novo monitor
            </Button>
          </>
        }
      />

      {erro && <ErroCarregamento mensagem={erro} aoTentarNovamente={recarregar} />}

      <Card className={cn("gap-0 py-0", !dados && erro && "hidden")}>
        {carregandoInicial ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : monitores.length === 0 && erro ? null : monitores.length === 0 ? (
          <div className="p-4">
            <EstadoVazio
              icone={RadarIcon}
              titulo="Nenhum monitor cadastrado"
              descricao="Crie um monitor com os mesmos filtros da pesquisa oficial do DJEN: OAB, advogado, parte, processo, teor, instituição, órgão e meio — sozinhos ou combinados."
              acao={
                <Button onClick={novo}>
                  <PlusIcon /> Criar o primeiro monitor
                </Button>
              }
            />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14 pl-4">Ativo</TableHead>
                <TableHead>Monitor</TableHead>
                <TableHead className="hidden md:table-cell">Instituição</TableHead>
                <TableHead className="hidden lg:table-cell">Destinatários</TableHead>
                <TableHead className="hidden sm:table-cell text-right">Comunicações</TableHead>
                <TableHead>Última sincronização</TableHead>
                <TableHead className="w-24 pr-4 text-right">
                  <span className="sr-only">Ações</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {monitores.map((m) => {
                const total = m.monitor_comunicacoes?.[0]?.count ?? 0;
                const sincronizandoEste = executando === m.id;
                return (
                  <TableRow key={m.id} className={cn(!m.ativo && "text-muted-foreground")}>
                    <TableCell className="pl-4">
                      <Switch
                        checked={m.ativo}
                        disabled={alternando === m.id}
                        onCheckedChange={(v) => alternarAtivo(m, v)}
                        aria-label={m.ativo ? `Pausar ${m.nome}` : `Ativar ${m.nome}`}
                      />
                    </TableCell>
                    <TableCell className="max-w-72 whitespace-normal">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          className="text-left font-medium text-foreground hover:underline"
                          onClick={() => editar(m)}
                        >
                          {m.nome}
                        </button>
                      </div>
                      <ResumoFiltros monitor={m} />
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        Retroativo: {m.dias_retroativos} {m.dias_retroativos === 1 ? "dia" : "dias"}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{m.sigla_tribunal ?? "Todas"}</TableCell>
                    <TableCell className="hidden max-w-56 lg:table-cell">
                      {m.emails?.length ? (
                        <span className="block truncate" title={m.emails.join(", ")}>
                          {m.emails.length === 1 ? m.emails[0] : `${m.emails.length} e-mails`}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Padrão</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-right sm:table-cell">
                      <Link
                        href={`/comunicacoes/?monitor=${m.id}`}
                        className="tabular-nums underline-offset-4 hover:underline"
                      >
                        {formatarNumero(total)}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {m.ultimo_erro ? (
                          <Tooltip>
                            <TooltipTrigger
                              render={<span className="inline-flex text-destructive" />}
                              aria-label="Último erro"
                            >
                              <AlertCircleIcon className="size-4" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-sm whitespace-pre-wrap">{m.ultimo_erro}</TooltipContent>
                          </Tooltip>
                        ) : m.ultima_sincronizacao ? (
                          <CheckCircle2Icon className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
                        ) : null}
                        <span className="tabular-nums" title={formatarDataHora(m.ultima_sincronizacao)}>
                          {m.ultima_sincronizacao
                            ? agora
                              ? tempoRelativo(m.ultima_sincronizacao, agora)
                              : formatarDataHora(m.ultima_sincronizacao)
                            : "Nunca"}
                        </span>
                      </div>
                      {m.ultimo_erro && (
                        <div className="mt-0.5 max-w-56 truncate text-xs text-destructive" title={m.ultimo_erro}>
                          {m.ultimo_erro}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <div className="flex justify-end gap-1">
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Sincronizar só ${m.nome}`}
                                disabled={executando !== null}
                                onClick={() => executar({ monitorId: m.id, nome: m.nome })}
                              />
                            }
                          >
                            {sincronizandoEste ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
                          </TooltipTrigger>
                          <TooltipContent>Sincronizar só este</TooltipContent>
                        </Tooltip>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={<Button variant="ghost" size="icon-sm" aria-label={`Mais ações para ${m.nome}`} />}
                          >
                            <MoreHorizontalIcon />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-44">
                            <DropdownMenuItem onClick={() => editar(m)}>
                              <PencilIcon /> Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={executando !== null}
                              onClick={() => executar({ monitorId: m.id, nome: m.nome })}
                            >
                              <RefreshCwIcon /> Sincronizar só este
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              render={<Link href={`/comunicacoes/?monitor=${m.id}`} />}
                            >
                              <RadarIcon /> Ver comunicações
                            </DropdownMenuItem>
                            <DropdownMenuItem render={<Link href={linkTestarNaPesquisa(m)} />}>
                              <SearchIcon /> Testar na pesquisa
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onClick={() => setExcluindo(m)}>
                              <Trash2Icon /> Excluir
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      <p className="text-xs text-muted-foreground">
        Destinatários “Padrão” usam os e-mails definidos em{" "}
        <Link href="/configuracoes/" className={buttonVariants({ variant: "link", className: "h-auto p-0 text-xs" })}>
          Configurações
        </Link>
        .
      </p>

      <MonitorFormDialog
        aberto={formAberto}
        aoMudarAberto={setFormAberto}
        monitor={editando}
        inicial={inicial}
        versao={versaoForm}
        aoSalvar={recarregar}
      />

      <Dialog open={excluindo !== null} onOpenChange={(v) => !v && !processandoExclusao && setExcluindo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir monitor?</DialogTitle>
            <DialogDescription>
              O monitor <strong className="text-foreground">{excluindo?.nome}</strong> deixará de ser
              sincronizado. As comunicações já registradas continuam no painel, mas perdem o vínculo com
              este monitor. Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExcluindo(null)} disabled={processandoExclusao}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={excluir} disabled={processandoExclusao}>
              {processandoExclusao && <Loader2Icon className="animate-spin" />}
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ResumoFiltros({ monitor }: { monitor: Monitor }) {
  const partes = partesResumo(normalizadosDeMonitor(monitor));
  if (!partes.length) {
    return <div className="mt-0.5 text-xs text-destructive">Sem filtros definidos</div>;
  }
  const texto = partes.map((p) => p.valor).join(" · ");
  return (
    <div className="mt-0.5 line-clamp-2 text-xs break-words text-muted-foreground" title={texto}>
      {partes.map((p, i) => (
        <span key={p.rotulo}>
          {i > 0 && <span aria-hidden> · </span>}
          <span className={p.rotulo === "OAB" || p.rotulo === "Processo" ? "font-mono" : undefined}>
            {p.valor}
          </span>
        </span>
      ))}
    </div>
  );
}
