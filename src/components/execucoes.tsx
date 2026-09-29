"use client";

import { StatusBadge } from "@/components/comum";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ORIGEM_EXECUCAO_ROTULO } from "@/lib/constants";
import { duracao, formatarData, formatarDataHora, formatarNumero } from "@/lib/format";
import type { MetaExecucao, Monitor, SyncExecucao } from "@/lib/types";
import { cn } from "@/lib/utils";

export function TabelaExecucoes({
  execucoes,
  aoSelecionar,
  compacta,
}: {
  execucoes: SyncExecucao[];
  aoSelecionar?: (e: SyncExecucao) => void;
  compacta?: boolean;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Início</TableHead>
          <TableHead>Status</TableHead>
          {!compacta && <TableHead>Origem</TableHead>}
          {!compacta && <TableHead className="text-right">Duração</TableHead>}
          <TableHead className="text-right">Req.</TableHead>
          <TableHead className="text-right">Encontr.</TableHead>
          <TableHead className="text-right">Novas</TableHead>
          <TableHead className="text-right">E-mails</TableHead>
          {!compacta && <TableHead>Mensagem</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {execucoes.map((e) => (
          <TableRow
            key={e.id}
            className={cn(aoSelecionar && "cursor-pointer")}
            onClick={aoSelecionar ? () => aoSelecionar(e) : undefined}
            tabIndex={aoSelecionar ? 0 : undefined}
            onKeyDown={
              aoSelecionar
                ? (ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      aoSelecionar(e);
                    }
                  }
                : undefined
            }
          >
            <TableCell className="tabular-nums">
              {formatarDataHora(e.iniciada_em)}
              {compacta && (
                <span className="ml-1.5 text-xs text-muted-foreground">
                  {ORIGEM_EXECUCAO_ROTULO[e.origem] ?? e.origem}
                </span>
              )}
            </TableCell>
            <TableCell>
              <StatusBadge status={e.status} />
            </TableCell>
            {!compacta && (
              <TableCell>
                <Badge variant="outline">{ORIGEM_EXECUCAO_ROTULO[e.origem] ?? e.origem}</Badge>
              </TableCell>
            )}
            {!compacta && (
              <TableCell className="text-right tabular-nums">
                {e.finalizada_em ? duracao(e.iniciada_em, e.finalizada_em) : "—"}
              </TableCell>
            )}
            <TableCell className="text-right tabular-nums">{formatarNumero(e.requisicoes)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatarNumero(e.encontradas)}</TableCell>
            <TableCell className="text-right font-medium tabular-nums">
              {formatarNumero(e.novas)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatarNumero(e.emails_enviados)}
            </TableCell>
            {!compacta && (
              <TableCell className="max-w-72 truncate text-muted-foreground" title={e.mensagem ?? ""}>
                {e.mensagem || "—"}
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Detalhes por monitor de uma execução (coluna jsonb `detalhes`). */
export function DetalhesExecucao({
  execucao,
  monitores,
}: {
  execucao: SyncExecucao;
  monitores: Pick<Monitor, "id" | "nome">[];
}) {
  const nomes = new Map(monitores.map((m) => [String(m.id), m.nome]));
  const metaBruto = (execucao.detalhes as Record<string, unknown> | null)?._execucao;
  const meta = metaBruto && typeof metaBruto === "object" ? (metaBruto as MetaExecucao) : null;
  // Chaves iniciadas por "_" (ex.: "_execucao") são metadados, não monitores.
  const entradas = Object.entries(execucao.detalhes ?? {}).filter(
    ([k, v]) => !k.startsWith("_") && v && typeof v === "object",
  );

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
        <Info rotulo="Status">
          <StatusBadge status={execucao.status} />
        </Info>
        <Info rotulo="Origem">{ORIGEM_EXECUCAO_ROTULO[execucao.origem] ?? execucao.origem}</Info>
        <Info rotulo="Duração">
          {execucao.finalizada_em ? duracao(execucao.iniciada_em, execucao.finalizada_em) : "em andamento"}
        </Info>
        <Info rotulo="Início">{formatarDataHora(execucao.iniciada_em)}</Info>
        <Info rotulo="Fim">{formatarDataHora(execucao.finalizada_em)}</Info>
        <Info rotulo="Requisições">{formatarNumero(execucao.requisicoes)}</Info>
        <Info rotulo="Encontradas">{formatarNumero(execucao.encontradas)}</Info>
        <Info rotulo="Novas">{formatarNumero(execucao.novas)}</Info>
        <Info rotulo="E-mails enviados">{formatarNumero(execucao.emails_enviados)}</Info>
      </dl>

      {execucao.mensagem && (
        <div className="rounded-lg border bg-muted/40 p-3 text-sm whitespace-pre-wrap break-words">
          {execucao.mensagem}
        </div>
      )}

      {meta && <SecaoMeta meta={meta} nomes={nomes} />}

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Por monitor</h3>
        {entradas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem detalhes por monitor nesta execução.</p>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Monitor</TableHead>
                  <TableHead className="text-right">Req.</TableHead>
                  <TableHead className="text-right">Encontr.</TableHead>
                  <TableHead className="text-right">Novas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entradas.map(([id, d]) => (
                  <TableRow key={id}>
                    <TableCell className="max-w-64 whitespace-normal">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">
                          {nomes.get(id) ?? (typeof d.nome === "string" && d.nome ? d.nome : `Monitor #${id}`)}
                        </span>
                        {d.parcial === true && <Badge variant="outline">parcial</Badge>}
                        {d.truncado === true && <Badge variant="outline">truncado</Badge>}
                      </div>
                      {d.erro && (
                        <div className="mt-0.5 text-xs break-words text-destructive">{String(d.erro)}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatarNumero(num(d.requisicoes))}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatarNumero(num(d.encontradas))}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatarNumero(num(d.novas))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}

function SecaoMeta({ meta, nomes }: { meta: MetaExecucao; nomes: Map<string, string> }) {
  const avisos = Array.isArray(meta.avisos) ? meta.avisos.filter((a) => typeof a === "string") : [];
  const email = meta.email ?? null;
  const falhas = Array.isArray(email?.falhas) ? email.falhas.filter((f) => typeof f === "string") : [];
  const rl = meta.rate_limit ?? null;
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">Execução</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
        <Info rotulo="Região">{meta.regiao || "—"}</Info>
        <Info rotulo="Data de referência">{meta.data_referencia ? formatarData(meta.data_referencia) : "—"}</Info>
        <Info rotulo="Escopo">
          {meta.monitor_id != null
            ? nomes.get(String(meta.monitor_id)) ?? `Monitor #${meta.monitor_id}`
            : "Todos os ativos"}
        </Info>
        <Info rotulo="Limite da API (restantes)">
          {rl && (rl.limite != null || rl.restantes != null)
            ? `${rl.restantes ?? "?"} de ${rl.limite ?? "?"}`
            : "—"}
        </Info>
        {meta.dry_run && <Info rotulo="Modo">Simulação</Info>}
        {email && (
          <>
            <Info rotulo="Envio de e-mail">{email.transporte || "não configurado"}</Info>
            <Info rotulo="E-mails enviados">{formatarNumero(num(email.enviados))}</Info>
            <Info rotulo="Comunicações notificadas">{formatarNumero(num(email.notificadas))}</Info>
            <Info rotulo="Pendentes de envio">{formatarNumero(num(email.pendentes))}</Info>
            <Info rotulo="Sem destinatário">{formatarNumero(num(email.sem_destinatario))}</Info>
          </>
        )}
      </dl>
      {(avisos.length > 0 || falhas.length > 0) && (
        <ul className="space-y-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          {avisos.map((a, i) => (
            <li key={`a${i}`} className="break-words">
              {a}
            </li>
          ))}
          {falhas.map((f, i) => (
            <li key={`f${i}`} className="break-words text-destructive">
              Falha de e-mail: {f}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function num(v: unknown) {
  return typeof v === "number" ? v : null;
}

function Info({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="mt-0.5 truncate">{children}</dd>
    </div>
  );
}
