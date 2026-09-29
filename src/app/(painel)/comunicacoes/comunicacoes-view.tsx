"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CheckCheckIcon,
  FilterXIcon,
  MailIcon,
  MailOpenIcon,
  RefreshCwIcon,
  SearchIcon,
} from "lucide-react";
import { toast } from "sonner";
import { EstadoVazio, ErroCarregamento, PageHeader } from "@/components/comum";
import { ComunicacaoDetalhe } from "@/components/comunicacao-detalhe";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDebounce, useQuery } from "@/hooks/use-query";
import { TAMANHO_PAGINA } from "@/lib/constants";
import { formatarData, formatarNumero, processoExibicao, somenteDigitos } from "@/lib/format";
import { mensagemErro, supabase } from "@/lib/supabase";
import type { Comunicacao, Monitor } from "@/lib/types";
import { cn } from "@/lib/utils";

const COLUNAS =
  "id,data_disponibilizacao,sigla_tribunal,tipo_comunicacao,tipo_documento,nome_orgao,numero_processo,numero_processo_mascara,nome_classe,meio,lida";

type Linha = Pick<
  Comunicacao,
  | "id"
  | "data_disponibilizacao"
  | "sigla_tribunal"
  | "tipo_comunicacao"
  | "tipo_documento"
  | "nome_orgao"
  | "numero_processo"
  | "numero_processo_mascara"
  | "nome_classe"
  | "meio"
  | "lida"
> & { monitor_comunicacoes: { monitor_id: number }[] };

interface Filtros {
  q: string;
  tribunal: string;
  monitor: string;
  de: string;
  ate: string;
  naoLidas: boolean;
  pagina: number;
}

function lerFiltros(sp: URLSearchParams): Filtros {
  const pagina = Number.parseInt(sp.get("pagina") ?? "1", 10);
  const data = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
  return {
    q: sp.get("q") ?? "",
    tribunal: (sp.get("tribunal") ?? "").toUpperCase(),
    monitor: /^\d+$/.test(sp.get("monitor") ?? "") ? (sp.get("monitor") as string) : "",
    de: data(sp.get("de")),
    ate: data(sp.get("ate")),
    naoLidas: sp.get("naoLidas") === "1",
    pagina: Number.isFinite(pagina) && pagina > 0 ? pagina : 1,
  };
}

/** Remove caracteres reservados da sintaxe de filtros do PostgREST. */
function limparTermo(t: string) {
  return t.replace(/[,()"\\*%:]/g, " ").replace(/\s+/g, " ").trim();
}

async function buscarComunicacoes(f: Filtros) {
  const sb = supabase();
  const embed = f.monitor ? "monitor_comunicacoes!inner(monitor_id)" : "monitor_comunicacoes(monitor_id)";
  let q = sb.from("comunicacoes").select(`${COLUNAS},${embed}`, { count: "exact" });

  const termo = limparTermo(f.q);
  if (termo) {
    const conds = [
      `texto.ilike."%${termo}%"`,
      `numero_processo_mascara.ilike."%${termo}%"`,
      `nome_orgao.ilike."%${termo}%"`,
      `nome_classe.ilike."%${termo}%"`,
    ];
    const dig = somenteDigitos(termo);
    if (dig.length >= 4) conds.push(`numero_processo.ilike."%${dig}%"`);
    q = q.or(conds.join(","));
  }
  if (f.tribunal) q = q.eq("sigla_tribunal", f.tribunal);
  if (f.monitor) q = q.eq("monitor_comunicacoes.monitor_id", Number(f.monitor));
  if (f.de) q = q.gte("data_disponibilizacao", f.de);
  if (f.ate) q = q.lte("data_disponibilizacao", f.ate);
  if (f.naoLidas) q = q.eq("lida", false);

  const inicio = (f.pagina - 1) * TAMANHO_PAGINA;
  const { data, error, count } = await q
    .order("data_disponibilizacao", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .range(inicio, inicio + TAMANHO_PAGINA - 1);

  if (error) {
    // Página além do fim (ex.: filtros mudaram): o PostgREST responde 416.
    if (error.code === "PGRST103") return { linhas: [] as Linha[], total: count ?? 0 };
    throw error;
  }
  return { linhas: (data ?? []) as unknown as Linha[], total: count ?? 0 };
}

async function buscarAuxiliares() {
  const sb = supabase();
  const [mon, trib] = await Promise.all([
    sb.from("monitores").select("id,nome").order("nome"),
    sb
      .from("comunicacoes")
      .select("sigla_tribunal")
      .not("sigla_tribunal", "is", null)
      .order("data_disponibilizacao", { ascending: false })
      .limit(1000),
  ]);
  if (mon.error) throw mon.error;
  const tribunais = Array.from(
    new Set((trib.data ?? []).map((r) => r.sigla_tribunal as string).filter(Boolean)),
  ).sort();
  return { monitores: (mon.data ?? []) as Pick<Monitor, "id" | "nome">[], tribunais };
}

export function ComunicacoesView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filtros = useMemo(() => lerFiltros(new URLSearchParams(searchParams.toString())), [searchParams]);
  const idAberto = /^\d+$/.test(searchParams.get("id") ?? "") ? Number(searchParams.get("id")) : null;

  const atualizarUrl = useCallback(
    (mudancas: Record<string, string | null>, manterPagina = false) => {
      const sp = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(mudancas)) {
        if (v === null || v === "") sp.delete(k);
        else sp.set(k, v);
      }
      if (!manterPagina && !("pagina" in mudancas)) sp.delete("pagina");
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  // Busca com debounce
  const [busca, setBusca] = useState(filtros.q);
  const buscaDebounced = useDebounce(busca, 400);
  useEffect(() => {
    // Só aplica quando o debounce "assentou" (evita reaplicar um termo antigo após limpar filtros).
    if (buscaDebounced !== busca) return;
    if (buscaDebounced.trim() !== filtros.q.trim()) atualizarUrl({ q: buscaDebounced.trim() || null });
  }, [busca, buscaDebounced, filtros.q, atualizarUrl]);

  const [tribunalDigitado, setTribunalDigitado] = useState(filtros.tribunal);

  const chave = JSON.stringify(filtros);
  const lista = useQuery(`comunicacoes:${chave}`, () => buscarComunicacoes(filtros));
  const aux = useQuery("comunicacoes:aux", buscarAuxiliares);
  const nomesMonitores = useMemo(
    () => new Map((aux.dados?.monitores ?? []).map((m) => [m.id, m.nome])),
    [aux.dados],
  );

  const total = lista.dados?.total ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / TAMANHO_PAGINA));
  const linhas = lista.dados?.linhas ?? [];
  const filtrosAtivos =
    !!filtros.q || !!filtros.tribunal || !!filtros.monitor || !!filtros.de || !!filtros.ate || filtros.naoLidas;

  const limparFiltros = () => {
    setBusca("");
    setTribunalDigitado("");
    atualizarUrl({ q: null, tribunal: null, monitor: null, de: null, ate: null, naoLidas: null });
  };

  const [marcando, setMarcando] = useState(false);
  const marcarLida = async (ids: number[], lida: boolean) => {
    if (!ids.length) return;
    setMarcando(true);
    const { error } = await supabase().from("comunicacoes").update({ lida }).in("id", ids);
    setMarcando(false);
    if (error) {
      toast.error("Não foi possível atualizar", { description: mensagemErro(error) });
      return;
    }
    if (ids.length > 1) toast.success(`${formatarNumero(ids.length)} comunicações marcadas como lidas.`);
    lista.recarregar();
  };

  const abrir = (id: number | null) => atualizarUrl({ id: id === null ? null : String(id) }, true);

  const itensMonitor = [
    { value: "", label: "Todos os monitores" },
    ...(aux.dados?.monitores ?? []).map((m) => ({ value: String(m.id), label: m.nome })),
  ];

  const inicio = total === 0 ? 0 : (filtros.pagina - 1) * TAMANHO_PAGINA + 1;
  const fim = Math.min(total, filtros.pagina * TAMANHO_PAGINA);
  const naoLidasNaPagina = linhas.filter((l) => !l.lida).map((l) => l.id);

  return (
    <div className="space-y-5">
      <PageHeader
        titulo="Comunicações"
        descricao="Publicações do DJEN encontradas pelos seus monitores."
        acoes={
          <>
            <Button
              variant="outline"
              size="icon"
              onClick={lista.recarregar}
              aria-label="Atualizar lista"
              disabled={lista.carregando}
            >
              <RefreshCwIcon className={cn(lista.carregando && "animate-spin")} />
            </Button>
            <Button
              variant="outline"
              onClick={() => marcarLida(naoLidasNaPagina, true)}
              disabled={marcando || naoLidasNaPagina.length === 0}
            >
              <CheckCheckIcon />
              Marcar página como lida
            </Button>
          </>
        }
      />

      {/* Filtros */}
      <Card size="sm">
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-12">
            <div className="space-y-1.5 sm:col-span-2 lg:col-span-4">
              <Label htmlFor="f-busca">Buscar</Label>
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="f-busca"
                  type="search"
                  placeholder="Nº do processo ou texto"
                  className="pl-8"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5 lg:col-span-2">
              <Label htmlFor="f-tribunal">Tribunal</Label>
              <Input
                id="f-tribunal"
                list="lista-tribunais"
                placeholder="Todos"
                value={tribunalDigitado}
                onChange={(e) => {
                  const v = e.target.value.toUpperCase().replace(/\s+/g, "");
                  setTribunalDigitado(v);
                  if (v === "" || aux.dados?.tribunais.includes(v)) atualizarUrl({ tribunal: v || null });
                }}
                onBlur={() => {
                  if (tribunalDigitado !== filtros.tribunal) atualizarUrl({ tribunal: tribunalDigitado || null });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") atualizarUrl({ tribunal: tribunalDigitado || null });
                }}
              />
              <datalist id="lista-tribunais">
                {(aux.dados?.tribunais ?? []).map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5 lg:col-span-2">
              <Label>Monitor</Label>
              <Select
                items={itensMonitor}
                value={filtros.monitor}
                onValueChange={(v) => atualizarUrl({ monitor: (v as string | null) || null })}
              >
                <SelectTrigger className="w-full" aria-label="Filtrar por monitor">
                  <SelectValue placeholder="Todos os monitores" />
                </SelectTrigger>
                <SelectContent>
                  {itensMonitor.map((i) => (
                    <SelectItem key={i.value || "todos"} value={i.value}>
                      {i.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 lg:col-span-2">
              <Label htmlFor="f-de">De</Label>
              <Input
                id="f-de"
                type="date"
                value={filtros.de}
                max={filtros.ate || undefined}
                onChange={(e) => atualizarUrl({ de: e.target.value || null })}
              />
            </div>
            <div className="space-y-1.5 lg:col-span-2">
              <Label htmlFor="f-ate">Até</Label>
              <Input
                id="f-ate"
                type="date"
                value={filtros.ate}
                min={filtros.de || undefined}
                onChange={(e) => atualizarUrl({ ate: e.target.value || null })}
              />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <Label className="cursor-pointer font-normal">
              <Checkbox
                checked={filtros.naoLidas}
                onCheckedChange={(v) => atualizarUrl({ naoLidas: v ? "1" : null })}
              />
              Somente não lidas
            </Label>
            {filtrosAtivos && (
              <Button variant="ghost" size="sm" onClick={limparFiltros}>
                <FilterXIcon /> Limpar filtros
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {lista.erro && <ErroCarregamento mensagem={lista.erro} aoTentarNovamente={lista.recarregar} />}

      {/* Tabela */}
      <Card className={cn("gap-0 py-0", !lista.dados && lista.erro && "hidden")}>
        {lista.carregandoInicial ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : linhas.length === 0 && lista.erro ? null : linhas.length === 0 ? (
          <div className="p-4">
            <EstadoVazio
              titulo={filtrosAtivos ? "Nada encontrado com esses filtros" : "Nenhuma comunicação registrada"}
              descricao={
                filtrosAtivos
                  ? "Ajuste ou limpe os filtros para ver mais resultados."
                  : "Quando os monitores encontrarem publicações no DJEN, elas aparecerão aqui."
              }
              acao={
                filtrosAtivos ? (
                  <Button variant="outline" size="sm" onClick={limparFiltros}>
                    Limpar filtros
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <div className={cn("transition-opacity", lista.carregando && "opacity-60")}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8 pl-4">
                    <span className="sr-only">Situação</span>
                  </TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Processo</TableHead>
                  <TableHead>Tribunal</TableHead>
                  <TableHead className="hidden md:table-cell">Tipo</TableHead>
                  <TableHead className="hidden lg:table-cell">Órgão</TableHead>
                  <TableHead className="hidden sm:table-cell">Monitores</TableHead>
                  <TableHead className="w-12 pr-4 text-right">
                    <span className="sr-only">Ações</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map((c) => (
                  <TableRow
                    key={c.id}
                    className={cn("cursor-pointer", !c.lida && "bg-sky-500/[0.04]")}
                    onClick={() => abrir(c.id)}
                  >
                    <TableCell className="pl-4">
                      <span
                        className={cn("block size-2 rounded-full", c.lida ? "bg-border" : "bg-sky-500")}
                        title={c.lida ? "Lida" : "Não lida"}
                      />
                    </TableCell>
                    <TableCell className="tabular-nums">{formatarData(c.data_disponibilizacao)}</TableCell>
                    <TableCell>
                      <button
                        type="button"
                        className={cn(
                          "text-left font-mono text-xs hover:underline sm:text-sm",
                          !c.lida && "font-semibold",
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          abrir(c.id);
                        }}
                      >
                        {processoExibicao(c)}
                      </button>
                      {c.nome_classe && (
                        <div className="max-w-64 truncate text-xs text-muted-foreground">{c.nome_classe}</div>
                      )}
                    </TableCell>
                    <TableCell>{c.sigla_tribunal ?? "—"}</TableCell>
                    <TableCell className="hidden max-w-44 truncate md:table-cell">
                      {c.tipo_comunicacao ?? "—"}
                    </TableCell>
                    <TableCell className="hidden max-w-56 truncate text-muted-foreground lg:table-cell">
                      {c.nome_orgao ?? "—"}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <div className="flex max-w-56 flex-wrap gap-1">
                        {c.monitor_comunicacoes.slice(0, 2).map((mc) => (
                          <Badge key={mc.monitor_id} variant="secondary" className="max-w-40 truncate">
                            {nomesMonitores.get(mc.monitor_id) ?? `#${mc.monitor_id}`}
                          </Badge>
                        ))}
                        {c.monitor_comunicacoes.length > 2 && (
                          <Badge variant="outline">+{c.monitor_comunicacoes.length - 2}</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={c.lida ? "Marcar como não lida" : "Marcar como lida"}
                              disabled={marcando}
                              onClick={(e) => {
                                e.stopPropagation();
                                marcarLida([c.id], !c.lida);
                              }}
                            />
                          }
                        >
                          {c.lida ? <MailIcon /> : <MailOpenIcon />}
                        </TooltipTrigger>
                        <TooltipContent>{c.lida ? "Marcar como não lida" : "Marcar como lida"}</TooltipContent>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Paginação */}
        {total > 0 && (
          <div className="flex flex-col items-center justify-between gap-2 border-t px-4 py-3 text-sm sm:flex-row">
            <span className="text-muted-foreground tabular-nums">
              {formatarNumero(inicio)}–{formatarNumero(fim)} de {formatarNumero(total)}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={filtros.pagina <= 1 || lista.carregando}
                onClick={() => atualizarUrl({ pagina: filtros.pagina - 1 > 1 ? String(filtros.pagina - 1) : null })}
              >
                <ChevronLeftIcon /> Anterior
              </Button>
              <span className="px-1 text-muted-foreground tabular-nums">
                {formatarNumero(filtros.pagina)} / {formatarNumero(totalPaginas)}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={filtros.pagina >= totalPaginas || lista.carregando}
                onClick={() => atualizarUrl({ pagina: String(filtros.pagina + 1) })}
              >
                Próxima <ChevronRightIcon />
              </Button>
            </div>
          </div>
        )}
      </Card>

      <ComunicacaoDetalhe
        id={idAberto}
        aoFechar={() => abrir(null)}
        aoAlterar={lista.recarregar}
      />
    </div>
  );
}
