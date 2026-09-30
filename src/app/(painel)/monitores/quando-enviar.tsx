"use client";

import { useId, useRef, useState } from "react";
import { ChevronRightIcon, MailIcon, PlusIcon, XIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DIAS_SEMANA,
  DIAS_UTEIS,
  fraseDias,
  juntarLista,
  normalizarDias,
  normalizarHorarios,
  OPCOES_HORARIO,
  TODOS_OS_DIAS,
  type ModoDias,
} from "@/lib/agendamento";
import { cn } from "@/lib/utils";
import { DIAS_RETROATIVOS_PADRAO, type ErrosForm, type ModoHorario, type MonitorForm } from "./monitor-schema";

const ITENS_HORARIO = OPCOES_HORARIO.map((h) => ({ value: h, label: h }));

const OPCOES_DIAS: { valor: ModoDias; rotulo: string }[] = [
  { valor: "uteis", rotulo: "Dias úteis (seg–sex)" },
  { valor: "todos", rotulo: "Todos os dias" },
  { valor: "personalizado", rotulo: "Personalizado" },
];

const OPCOES_HORARIO_MODO: { valor: ModoHorario; rotulo: string }[] = [
  { valor: "publicar", rotulo: "Assim que publicar (verifica a cada 30 min)" },
  { valor: "fixos", rotulo: "Em horários fixos" },
];

/** Grupo de opções mutuamente exclusivas (semântica de radio, setas do teclado navegam). */
function OpcoesSegmentadas<T extends string>({
  rotuloId,
  opcoes,
  valor,
  aoMudar,
}: {
  rotuloId: string;
  opcoes: { valor: T; rotulo: string }[];
  valor: T;
  aoMudar: (v: T) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const mover = (atual: number, delta: number) => {
    const i = (atual + delta + opcoes.length) % opcoes.length;
    aoMudar(opcoes[i].valor);
    refs.current[i]?.focus();
  };
  return (
    <div role="radiogroup" aria-labelledby={rotuloId} className="flex flex-wrap gap-1.5">
      {opcoes.map((o, i) => {
        const marcado = o.valor === valor;
        return (
          <button
            key={o.valor}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={marcado}
            tabIndex={marcado ? 0 : -1}
            onClick={() => aoMudar(o.valor)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                mover(i, 1);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                mover(i, -1);
              }
            }}
            className={cn(
              "inline-flex min-h-8 items-center rounded-lg border px-2.5 py-1 text-left text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
              marcado
                ? "border-primary bg-primary/10 font-medium text-foreground"
                : "border-input text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {o.rotulo}
          </button>
        );
      })}
    </div>
  );
}

/** Texto-resumo do agendamento, em linguagem simples. */
export function textoResumoAgendamento(form: Pick<MonitorForm, "dias_semana" | "modo_horario" | "horarios">) {
  const dias = fraseDias(form.dias_semana);
  const horarios = normalizarHorarios(form.horarios);
  if (form.modo_horario === "fixos") {
    if (!horarios.length) return `${dias}, nos horários que você escolher — adicione pelo menos um horário.`;
    return `${dias}, às ${juntarLista(horarios)} — você recebe um resumo por e-mail em cada horário, com o que foi publicado desde o último envio.`;
  }
  return `${dias}, assim que publicar — o DJEN é consultado a cada 30 min e você recebe um e-mail sempre que houver publicações novas.`;
}

export function QuandoEnviar({
  form,
  erros,
  aoMudar,
}: {
  form: MonitorForm;
  erros: ErrosForm;
  aoMudar: (mudancas: Partial<MonitorForm>) => void;
}) {
  const base = useId();
  const id = (c: string) => `${base}-${c}`;
  const [avancadoAberto, setAvancadoAberto] = useState(false);

  const dias = normalizarDias(form.dias_semana);
  const horarios = normalizarHorarios(form.horarios);

  const escolherModoDias = (modo: ModoDias) => {
    if (modo === "uteis") aoMudar({ modo_dias: modo, dias_semana: DIAS_UTEIS });
    else if (modo === "todos") aoMudar({ modo_dias: modo, dias_semana: TODOS_OS_DIAS });
    else aoMudar({ modo_dias: modo });
  };

  const alternarDia = (d: number) => {
    const novos = dias.includes(d) ? dias.filter((x) => x !== d) : normalizarDias([...dias, d]);
    if (!novos.length) return; // pelo menos 1 dia
    aoMudar({ modo_dias: "personalizado", dias_semana: novos });
  };

  const escolherModoHorario = (modo: ModoHorario) => {
    // Ao ativar horários fixos sem nenhum escolhido, sugere 08:00 para já mostrar o formato.
    if (modo === "fixos" && !horarios.length) aoMudar({ modo_horario: modo, horarios: ["08:00"] });
    else aoMudar({ modo_horario: modo });
  };

  const adicionarHorario = (h: string) => aoMudar({ horarios: normalizarHorarios([...horarios, h]) });
  const removerHorario = (h: string) => aoMudar({ horarios: horarios.filter((x) => x !== h) });

  const avancadoVisivel = avancadoAberto || !!erros.dias_retroativos;

  return (
    <fieldset className="grid gap-4 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">Quando enviar</legend>

      {/* Dias da semana */}
      <div className="grid gap-2">
        <div id={id("dias-rotulo")} className="text-sm font-medium">
          Dias da semana
        </div>
        <OpcoesSegmentadas
          rotuloId={id("dias-rotulo")}
          opcoes={OPCOES_DIAS}
          valor={form.modo_dias}
          aoMudar={escolherModoDias}
        />
        <div role="group" aria-label="Dias da semana escolhidos" className="flex flex-wrap items-center gap-1.5">
          {DIAS_SEMANA.map((info) => {
            const d = info.valor;
            const marcado = dias.includes(d);
            const unico = marcado && dias.length === 1;
            return (
              <button
                key={d}
                type="button"
                aria-pressed={marcado}
                aria-label={info.nome}
                title={unico ? `${info.nome} — escolha pelo menos um dia` : info.nome}
                aria-disabled={unico || undefined}
                onClick={() => alternarDia(d)}
                className={cn(
                  "inline-flex size-8 items-center justify-center rounded-full border text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  marcado
                    ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                    : "border-input text-muted-foreground hover:bg-muted hover:text-foreground",
                  unico && "cursor-not-allowed",
                )}
              >
                <span aria-hidden>{info.letra}</span>
              </button>
            );
          })}
        </div>
        {erros.dias_semana ? (
          <p className="text-xs text-destructive">{erros.dias_semana}</p>
        ) : (
          <p className="text-xs text-muted-foreground">O DJEN normalmente não publica em fins de semana.</p>
        )}
      </div>

      {/* Horário */}
      <div className="grid gap-2">
        <div id={id("horario-rotulo")} className="text-sm font-medium">
          Horário
        </div>
        <OpcoesSegmentadas
          rotuloId={id("horario-rotulo")}
          opcoes={OPCOES_HORARIO_MODO}
          valor={form.modo_horario}
          aoMudar={escolherModoHorario}
        />
        {form.modo_horario === "fixos" && (
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {horarios.length > 0 && (
              <ul aria-label="Horários de envio" className="flex flex-wrap items-center gap-1.5">
                {horarios.map((h) => (
                  <li
                    key={h}
                    className="inline-flex h-8 items-center gap-0.5 rounded-lg border bg-muted/50 pr-0.5 pl-2.5 text-sm tabular-nums"
                  >
                    {h}
                    <button
                      type="button"
                      onClick={() => removerHorario(h)}
                      aria-label={`Remover ${h}`}
                      className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <XIcon className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
              )}
              <Select
                items={ITENS_HORARIO}
                value={null}
                onValueChange={(v) => {
                  if (typeof v === "string" && v) adicionarHorario(v);
                }}
              >
                <SelectTrigger
                  className="w-44"
                  aria-label="Adicionar horário"
                  aria-invalid={erros.horarios ? true : undefined}
                >
                  <PlusIcon className="text-muted-foreground" />
                  <SelectValue placeholder="Adicionar horário" />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false} className="max-h-72">
                  {ITENS_HORARIO.map((i) => (
                    <SelectItem key={i.value} value={i.value} disabled={horarios.includes(i.value)}>
                      {i.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {erros.horarios ? (
              <p className="text-xs text-destructive">{erros.horarios}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Horário de Brasília, de 30 em 30 minutos. O envio sai na primeira verificação a partir do horário
                (até 30 min depois).
              </p>
            )}
          </div>
        )}
      </div>

      {/* Resumo */}
      <p
        className="flex gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm text-foreground/90"
        aria-live="polite"
      >
        <MailIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span>{textoResumoAgendamento(form)}</span>
      </p>

      {/* Avançado */}
      <details
        open={avancadoVisivel}
        onToggle={(e) => setAvancadoAberto(e.currentTarget.open)}
        className="group rounded-lg"
      >
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md text-sm font-medium text-muted-foreground outline-none select-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
          <ChevronRightIcon className="size-4 transition-transform group-open:rotate-90" aria-hidden />
          Avançado
        </summary>
        <div className="mt-3 grid gap-1.5 pl-5">
          <label htmlFor={id("dias")} className="flex flex-wrap items-center gap-2 text-sm">
            <span>Na primeira busca, incluir publicações dos últimos</span>
            <Input
              id={id("dias")}
              type="number"
              min={0}
              max={30}
              step={1}
              inputMode="numeric"
              className="w-20"
              value={form.dias_retroativos}
              onChange={(e) => aoMudar({ dias_retroativos: e.target.value })}
              aria-invalid={erros.dias_retroativos ? true : undefined}
              aria-describedby={id("dias-ajuda")}
            />
            <span>dias</span>
          </label>
          {erros.dias_retroativos ? (
            <p id={id("dias-ajuda")} className="text-xs text-destructive">
              {erros.dias_retroativos}
            </p>
          ) : (
            <p id={id("dias-ajuda")} className="text-xs text-muted-foreground">
              Vale só para a primeira sincronização deste monitor (0 a 30; padrão {DIAS_RETROATIVOS_PADRAO}). Depois,
              cada busca começa de onde a anterior parou — nada publicado nos dias não agendados fica de fora.
            </p>
          )}
        </div>
      </details>
    </fieldset>
  );
}
