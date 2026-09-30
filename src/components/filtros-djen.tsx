"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { EraserIcon, Loader2Icon, RotateCwIcon, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
} from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@/hooks/use-query";
import { MEIOS_DJEN, UFS } from "@/lib/constants";
import { listarOrgaos, listarTribunais } from "@/lib/djen-api";
import type { CampoFiltro, ErrosFiltros, FiltrosDjen, ModoFiltros } from "@/lib/filtros";
import { MIN_NOME, MIN_TEXTO } from "@/lib/filtros";
import { mascararProcesso, somenteDigitos } from "@/lib/format";
import { cn } from "@/lib/utils";

const ITENS_MEIO = [
  { value: "", label: "Todos os meios" },
  ...MEIOS_DJEN.map((m) => ({ value: m.value, label: m.label })),
];
const ITENS_UF = [{ value: "", label: "Todas" }, ...UFS.map((u) => ({ value: u, label: u }))];

/** Quantos órgãos mostrar por vez (o TJRJ, por exemplo, tem mais de 2.000). */
const LIMITE_ORGAOS = 150;

/** Minúsculas e sem acentos, para busca tolerante. */
function normalizarBusca(v: string) {
  return v
    .normalize("NFKD") // NFKD também converte ª/º em a/o
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Todas as palavras da busca precisam aparecer (em qualquer ordem). */
function combina(alvo: string, busca: string) {
  const q = normalizarBusca(busca);
  if (!q) return true;
  const t = normalizarBusca(alvo);
  return q.split(" ").every((p) => t.includes(p));
}

function siglaNormalizada(v: string) {
  return v.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// ---------------------------------------------------------------------------

function Campo({
  id,
  rotulo,
  erro,
  ajuda,
  className,
  children,
}: {
  id?: string;
  rotulo: string;
  erro?: string;
  ajuda?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <Label htmlFor={id} className="mb-1.5">
        {rotulo}
      </Label>
      {children}
      {erro ? (
        <p className="mt-1 text-xs text-destructive" role="alert">
          {erro}
        </p>
      ) : ajuda ? (
        <p className="mt-1 text-xs text-muted-foreground">{ajuda}</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Instituição (agrupada por estado, com busca)
// ---------------------------------------------------------------------------

interface ItemInstituicao {
  value: string; // sigla
  label: string; // "TJRJ – Tribunal de Justiça…"
  nome: string;
  grupo: string;
}
interface GrupoInstituicao {
  value: string; // rótulo do grupo
  items: ItemInstituicao[];
}

function SeletorInstituicao({
  id,
  sigla,
  aoMudar,
  invalido,
  desabilitado,
}: {
  id: string;
  sigla: string;
  aoMudar: (sigla: string) => void;
  invalido?: boolean;
  desabilitado?: boolean;
}) {
  const lista = useQuery("djen:tribunais", listarTribunais);

  const grupos = useMemo<GrupoInstituicao[]>(
    () =>
      (lista.dados ?? []).map((g) => {
        const rotulo = g.uf ? `${g.nomeEstado} (${g.uf})` : "Nacional";
        return {
          value: rotulo,
          items: g.instituicoes.map((i) => ({
            value: i.sigla,
            label: `${i.sigla} – ${i.nome}`,
            nome: i.nome,
            grupo: rotulo,
          })),
        };
      }),
    [lista.dados],
  );

  // Coloca primeiro a instituição cuja sigla é exatamente a digitada
  // (ex.: "TRT1" não deve selecionar TRT14 ao apertar Enter).
  const [busca, setBusca] = useState("");
  const gruposOrdenados = useMemo(() => {
    const q = siglaNormalizada(busca);
    if (!q) return grupos;
    const exato = (i: ItemInstituicao) => siglaNormalizada(i.value) === q;
    const comExato = grupos
      .filter((g) => g.items.some(exato))
      .map((g) => ({ ...g, items: [...g.items.filter(exato), ...g.items.filter((i) => !exato(i))] }));
    if (!comExato.length) return grupos;
    return [...comExato, ...grupos.filter((g) => !g.items.some(exato))];
  }, [grupos, busca]);

  const selecionado = useMemo<ItemInstituicao | null>(() => {
    if (!sigla) return null;
    for (const g of grupos) {
      const achado = g.items.find((i) => i.value === sigla);
      if (achado) return achado;
    }
    return { value: sigla, label: sigla, nome: sigla, grupo: "" };
  }, [grupos, sigla]);

  // Sem a lista (API fora do ar), permite digitar a sigla.
  if (lista.erro && !lista.dados) {
    return (
      <div className="space-y-1">
        <Input
          id={id}
          value={sigla}
          onChange={(e) => aoMudar(e.target.value.toUpperCase().replace(/\s+/g, ""))}
          placeholder="Sigla (ex.: TJRJ)"
          aria-invalid={invalido || undefined}
          disabled={desabilitado}
        />
        <p className="flex flex-wrap items-center gap-1 text-xs text-warning-text">
          Não foi possível carregar a lista de instituições; digite a sigla.
          <Button type="button" variant="link" size="xs" className="h-auto p-0" onClick={lista.recarregar}>
            <RotateCwIcon /> Tentar de novo
          </Button>
        </p>
      </div>
    );
  }

  return (
    <Combobox<ItemInstituicao>
      items={gruposOrdenados}
      value={selecionado}
      onValueChange={(v) => aoMudar(v?.value ?? "")}
      onInputValueChange={setBusca}
      isItemEqualToValue={(a, b) => a.value === b.value}
      itemToStringLabel={(i) => i.label}
      filter={(item, busca) => combina(`${item.label} ${item.grupo}`, busca)}
      disabled={desabilitado || lista.carregandoInicial}
      autoHighlight
    >
      <ComboboxInput
        id={id}
        className="w-full"
        placeholder={lista.carregandoInicial ? "Carregando instituições…" : "Todas as instituições"}
        showClear={!!sigla}
        disabled={desabilitado || lista.carregandoInicial}
        aria-invalid={invalido || undefined}
      />
      <ComboboxContent>
        <ComboboxEmpty>Nenhuma instituição encontrada.</ComboboxEmpty>
        <ComboboxList>
          {(grupo: GrupoInstituicao) => (
            <ComboboxGroup key={grupo.value} items={grupo.items}>
              <ComboboxLabel>{grupo.value}</ComboboxLabel>
              <ComboboxCollection>
                {(item: ItemInstituicao) => (
                  <ComboboxItem key={`${grupo.value}:${item.value}`} value={item}>
                    <span className="flex min-w-0 flex-col">
                      <span className="font-medium">{item.value}</span>
                      <span className="truncate text-xs text-muted-foreground">{item.nome}</span>
                    </span>
                  </ComboboxItem>
                )}
              </ComboboxCollection>
            </ComboboxGroup>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

// ---------------------------------------------------------------------------
// Órgão (depende da instituição; lista grande, com busca)
// ---------------------------------------------------------------------------

interface ItemOrgao {
  value: string; // id
  label: string; // nome
}

function SeletorOrgao({
  id,
  sigla,
  orgaoId,
  orgaoNome,
  aoMudar,
  invalido,
  desabilitado,
}: {
  id: string;
  sigla: string;
  orgaoId: string;
  orgaoNome: string;
  aoMudar: (orgao: { id: string; nome: string }) => void;
  invalido?: boolean;
  desabilitado?: boolean;
}) {
  const siglaValida = /^[A-Za-z0-9-]{2,20}$/.test(sigla) ? sigla.toUpperCase() : "";
  const lista = useQuery(siglaValida ? `djen:orgaos:${siglaValida}` : null, () => listarOrgaos(siglaValida));
  const orgaos = useMemo<ItemOrgao[]>(
    () => (siglaValida ? (lista.dados ?? []).map((o) => ({ value: String(o.id), label: o.nome })) : []),
    [lista.dados, siglaValida],
  );

  const selecionado = useMemo<ItemOrgao | null>(() => {
    if (!orgaoId) return null;
    return orgaos.find((o) => o.value === orgaoId) ?? { value: orgaoId, label: orgaoNome || `Órgão ${orgaoId}` };
  }, [orgaos, orgaoId, orgaoNome]);

  // Preenche o nome quando o órgão veio só com o id (ex.: link compartilhado).
  const nomeResolvido = orgaoId && !orgaoNome ? orgaos.find((o) => o.value === orgaoId)?.label : undefined;
  useEffect(() => {
    if (nomeResolvido) aoMudar({ id: orgaoId, nome: nomeResolvido });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nomeResolvido]);

  const carregando = !!siglaValida && lista.carregando && !lista.dados;
  const semInstituicao = !siglaValida;
  const bloqueado = desabilitado || semInstituicao || carregando;

  return (
    <div className="space-y-1">
      <Combobox<ItemOrgao>
        items={orgaos}
        value={selecionado}
        onValueChange={(v) => aoMudar({ id: v?.value ?? "", nome: v?.label ?? "" })}
        isItemEqualToValue={(a, b) => a.value === b.value}
        itemToStringLabel={(i) => i.label}
        filter={(item, busca) => combina(item.label, busca)}
        limit={LIMITE_ORGAOS}
        disabled={bloqueado}
        autoHighlight
      >
        <ComboboxInput
          id={id}
          className="w-full"
          placeholder={
            semInstituicao
              ? "Escolha a instituição primeiro"
              : carregando
                ? "Carregando órgãos…"
                : "Todos os órgãos"
          }
          showClear={!!orgaoId && !bloqueado}
          disabled={bloqueado}
          aria-invalid={invalido || undefined}
        />
        <ComboboxContent>
          <ComboboxEmpty>Nenhum órgão encontrado.</ComboboxEmpty>
          <ComboboxList>
            {(item: ItemOrgao) => (
              <ComboboxItem key={item.value} value={item}>
                <span className="min-w-0 whitespace-normal">{item.label}</span>
              </ComboboxItem>
            )}
          </ComboboxList>
          {orgaos.length > LIMITE_ORGAOS && (
            <div className="border-t px-2.5 py-1.5 text-xs text-muted-foreground">
              {orgaos.length.toLocaleString("pt-BR")} órgãos — digite parte do nome para refinar.
            </div>
          )}
        </ComboboxContent>
      </Combobox>
      {lista.erro && !lista.dados && siglaValida && (
        <p className="flex flex-wrap items-center gap-1 text-xs text-warning-text">
          Não foi possível carregar os órgãos.
          <Button type="button" variant="link" size="xs" className="h-auto p-0" onClick={lista.recarregar}>
            <RotateCwIcon /> Tentar de novo
          </Button>
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formulário completo
// ---------------------------------------------------------------------------

export interface FiltrosDjenProps {
  modo: ModoFiltros;
  valor: FiltrosDjen;
  aoMudar: (v: FiltrosDjen) => void;
  erros?: ErrosFiltros;
  /** Chamado quando um campo com erro é alterado (para o pai limpar o erro). */
  aoLimparErro?: (campo: CampoFiltro | "geral") => void;
  /** Modo monitor: conteúdo exibido no lugar das datas (ex.: aviso de período automático). */
  periodo?: React.ReactNode;
  desabilitado?: boolean;
  /** Modo pesquisa: quando informado, renderiza um <form> com os botões Limpar e Pesquisar. */
  aoPesquisar?: () => void;
  aoLimpar?: () => void;
  pesquisando?: boolean;
  /** Desabilita o botão Pesquisar e mostra o motivo (ex.: contagem regressiva do limite da API). */
  pesquisaBloqueada?: string | null;
  className?: string;
}

/**
 * Os mesmos filtros do formulário oficial de pesquisa do DJEN, na mesma ordem.
 * Cada filtro funciona sozinho ou combinado. Layout por container query:
 * estreito = um campo por linha (datas lado a lado); largo = grade de 12 colunas.
 */
export function FiltrosDjenForm({
  modo,
  valor,
  aoMudar,
  erros = {},
  aoLimparErro,
  periodo,
  desabilitado,
  aoPesquisar,
  aoLimpar,
  pesquisando,
  pesquisaBloqueada,
  className,
}: FiltrosDjenProps) {
  const base = useId();
  const id = (c: string) => `${base}-${c}`;

  const set = (mudancas: Partial<FiltrosDjen>) => {
    aoMudar({ ...valor, ...mudancas });
    for (const k of Object.keys(mudancas) as CampoFiltro[]) if (erros[k]) aoLimparErro?.(k);
    if (erros.geral) aoLimparErro?.("geral");
  };

  const campos = (
    <div className="grid grid-cols-2 gap-x-3 gap-y-4 @xl:grid-cols-12">
      <Campo
        id={id("texto")}
        rotulo="Teor da comunicação"
        erro={erros.texto}
        className="col-span-2 @xl:col-span-12"
        ajuda={`Palavras do texto da publicação (mín. ${MIN_TEXTO} caracteres).`}
      >
        <Input
          id={id("texto")}
          value={valor.texto}
          onChange={(e) => set({ texto: e.target.value })}
          placeholder="Ex.: audiência de conciliação"
          aria-invalid={erros.texto ? true : undefined}
          disabled={desabilitado}
          maxLength={500}
        />
      </Campo>

      <Campo
        id={id("instituicao")}
        rotulo="Instituição"
        erro={erros.siglaTribunal}
        className="col-span-2 @xl:col-span-5"
      >
        <SeletorInstituicao
          id={id("instituicao")}
          sigla={valor.siglaTribunal}
          aoMudar={(sigla) => {
            if (sigla === valor.siglaTribunal) return;
            set({ siglaTribunal: sigla, orgaoId: "", orgaoNome: "" });
          }}
          invalido={!!erros.siglaTribunal}
          desabilitado={desabilitado}
        />
      </Campo>

      <Campo id={id("orgao")} rotulo="Órgão" erro={erros.orgaoId} className="col-span-2 @xl:col-span-7">
        <SeletorOrgao
          id={id("orgao")}
          sigla={valor.siglaTribunal}
          orgaoId={valor.orgaoId}
          orgaoNome={valor.orgaoNome}
          aoMudar={(o) => set({ orgaoId: o.id, orgaoNome: o.nome })}
          invalido={!!erros.orgaoId}
          desabilitado={desabilitado}
        />
      </Campo>

      <Campo rotulo="Meio" erro={erros.meio} className="col-span-2 @xl:col-span-4">
        <Select
          items={ITENS_MEIO}
          value={valor.meio}
          onValueChange={(v) => set({ meio: (v === "D" || v === "E" ? v : "") as FiltrosDjen["meio"] })}
          disabled={desabilitado}
        >
          <SelectTrigger className="w-full" aria-label="Meio">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ITENS_MEIO.map((i) => (
              <SelectItem key={i.value || "todos"} value={i.value}>
                {i.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Campo>

      {modo === "pesquisa" ? (
        <>
          <Campo
            id={id("de")}
            rotulo="Data inicial"
            erro={erros.dataInicio}
            className="col-span-1 @xl:col-span-4"
          >
            <Input
              id={id("de")}
              type="date"
              value={valor.dataInicio}
              max={valor.dataFim || undefined}
              onChange={(e) => set({ dataInicio: e.target.value })}
              aria-invalid={erros.dataInicio ? true : undefined}
              disabled={desabilitado}
            />
          </Campo>
          <Campo id={id("ate")} rotulo="Data final" erro={erros.dataFim} className="col-span-1 @xl:col-span-4">
            <Input
              id={id("ate")}
              type="date"
              value={valor.dataFim}
              min={valor.dataInicio || undefined}
              onChange={(e) => set({ dataFim: e.target.value })}
              aria-invalid={erros.dataFim ? true : undefined}
              disabled={desabilitado}
            />
          </Campo>
        </>
      ) : (
        <div className="col-span-2 min-w-0 @xl:col-span-8">{periodo}</div>
      )}

      <Campo
        id={id("processo")}
        rotulo="Nº do processo"
        erro={erros.numeroProcesso}
        className="col-span-2 @xl:col-span-6"
        ajuda="Com ou sem a máscara CNJ (20 dígitos)."
      >
        <Input
          id={id("processo")}
          value={valor.numeroProcesso}
          onChange={(e) => set({ numeroProcesso: e.target.value })}
          onBlur={() => {
            if (somenteDigitos(valor.numeroProcesso).length === 20) {
              const m = mascararProcesso(valor.numeroProcesso);
              if (m !== valor.numeroProcesso) aoMudar({ ...valor, numeroProcesso: m });
            }
          }}
          placeholder="0000000-00.0000.0.00.0000"
          inputMode="numeric"
          autoComplete="off"
          aria-invalid={erros.numeroProcesso ? true : undefined}
          disabled={desabilitado}
          maxLength={40}
        />
      </Campo>

      <Campo
        id={id("parte")}
        rotulo="Nome da parte"
        erro={erros.nomeParte}
        className="col-span-2 @xl:col-span-6"
        ajuda={`Mín. ${MIN_NOME} caracteres.`}
      >
        <Input
          id={id("parte")}
          value={valor.nomeParte}
          onChange={(e) => set({ nomeParte: e.target.value })}
          placeholder="Pessoa física ou jurídica"
          aria-invalid={erros.nomeParte ? true : undefined}
          disabled={desabilitado}
          maxLength={200}
        />
      </Campo>

      <Campo
        id={id("advogado")}
        rotulo="Nome do advogado"
        erro={erros.nomeAdvogado}
        className="col-span-2 @xl:col-span-6"
        ajuda={`Mín. ${MIN_NOME} caracteres.`}
      >
        <Input
          id={id("advogado")}
          value={valor.nomeAdvogado}
          onChange={(e) => set({ nomeAdvogado: e.target.value })}
          placeholder="Nome como aparece nas publicações"
          aria-invalid={erros.nomeAdvogado ? true : undefined}
          disabled={desabilitado}
          maxLength={200}
        />
      </Campo>

      <Campo id={id("oab")} rotulo="Nº da OAB" erro={erros.numeroOab} className="col-span-2 @xl:col-span-3">
        <Input
          id={id("oab")}
          value={valor.numeroOab}
          onChange={(e) => set({ numeroOab: e.target.value })}
          placeholder="Ex.: 123456"
          autoComplete="off"
          aria-invalid={erros.numeroOab ? true : undefined}
          disabled={desabilitado}
          maxLength={20}
        />
      </Campo>

      <Campo rotulo="UF da OAB" erro={erros.ufOab} className="col-span-2 @xl:col-span-3">
        <Select
          items={ITENS_UF}
          value={valor.ufOab}
          onValueChange={(v) => set({ ufOab: typeof v === "string" ? v : "" })}
          disabled={desabilitado}
        >
          <SelectTrigger className="w-full" aria-label="UF da OAB" aria-invalid={erros.ufOab ? true : undefined}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ITENS_UF.map((i) => (
              <SelectItem key={i.value || "todas"} value={i.value}>
                {i.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Campo>

      {erros.geral && (
        <p className="col-span-2 text-sm text-destructive @xl:col-span-12" role="alert">
          {erros.geral}
        </p>
      )}
    </div>
  );

  if (!aoPesquisar) return <div className={cn("@container", className)}>{campos}</div>;

  return (
    <form
      className={cn("@container space-y-4", className)}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        aoPesquisar();
      }}
    >
      {campos}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
        {pesquisaBloqueada && (
          <p className="text-xs text-muted-foreground sm:mr-auto" aria-live="polite">
            {pesquisaBloqueada}
          </p>
        )}
        <Button type="button" variant="outline" onClick={aoLimpar} disabled={desabilitado || pesquisando}>
          <EraserIcon /> Limpar
        </Button>
        <Button type="submit" disabled={desabilitado || pesquisando || !!pesquisaBloqueada}>
          {pesquisando ? <Loader2Icon className="animate-spin" /> : <SearchIcon />}
          Pesquisar
        </Button>
      </div>
    </form>
  );
}
