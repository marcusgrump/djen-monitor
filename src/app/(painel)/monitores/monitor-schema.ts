import { z } from "zod";
import {
  DIAS_UTEIS,
  modoDosDias,
  normalizarDias,
  normalizarHorarios,
  REGEX_HORARIO,
  type ModoDias,
} from "@/lib/agendamento";
import {
  colunasMonitor,
  FILTROS_VAZIOS,
  filtrosDeMonitor,
  resumoFiltros,
  validarFiltros,
  type ErrosFiltros,
  type FiltrosDjen,
} from "@/lib/filtros";
import type { Monitor, MonitorInput } from "@/lib/types";

/** "publicar" = assim que publicar (a cada execução do cron); "fixos" = só nos horários escolhidos. */
export type ModoHorario = "publicar" | "fixos";

/** Estado do formulário (tudo como o usuário digita). */
export interface MonitorForm {
  nome: string;
  filtros: FiltrosDjen;
  emails: string[];
  /** Conta de envio (id em texto); "" = conta padrão. */
  conta_envio_id: string;
  /** Opção rápida selecionada (a lista real está em dias_semana). */
  modo_dias: ModoDias;
  dias_semana: number[];
  modo_horario: ModoHorario;
  /** Mantida ao voltar para "assim que publicar"; só é salva no modo "fixos". */
  horarios: string[];
  /** Janela da primeira busca (monitor nunca sincronizado). */
  dias_retroativos: string;
  ativo: boolean;
}

export const DIAS_RETROATIVOS_PADRAO = 3;

/** Padrões: dias úteis, assim que publicar, primeira busca de 3 dias. */
export const FORM_VAZIO: MonitorForm = {
  nome: "",
  filtros: FILTROS_VAZIOS,
  emails: [],
  conta_envio_id: "",
  modo_dias: "uteis",
  dias_semana: DIAS_UTEIS,
  modo_horario: "publicar",
  horarios: [],
  dias_retroativos: String(DIAS_RETROATIVOS_PADRAO),
  ativo: true,
};

export function formDeMonitor(m: Monitor): MonitorForm {
  const dias = normalizarDias(m.dias_semana);
  const diasSemana = dias.length ? dias : DIAS_UTEIS;
  const horarios = normalizarHorarios(m.horarios);
  return {
    nome: m.nome,
    filtros: filtrosDeMonitor(m),
    emails: m.emails ?? [],
    conta_envio_id: m.conta_envio_id != null ? String(m.conta_envio_id) : "",
    modo_dias: modoDosDias(diasSemana),
    dias_semana: diasSemana,
    modo_horario: horarios.length ? "fixos" : "publicar",
    horarios,
    dias_retroativos: String(m.dias_retroativos ?? DIAS_RETROATIVOS_PADRAO),
    ativo: m.ativo,
  };
}

/** Formulário novo pré-preenchido com filtros (vindos da página Pesquisar); agendamento padrão. */
export function formDeFiltros(f: FiltrosDjen): MonitorForm {
  const filtros = { ...f, dataInicio: "", dataFim: "" };
  const r = validarFiltros(filtros, "monitor");
  const sugestao = r.ok ? resumoFiltros(r.dados).slice(0, 120) : "";
  return { ...FORM_VAZIO, nome: sugestao, filtros };
}

const dadosSchema = z
  .object({
    nome: z.string().trim().min(1, "Informe um nome para o monitor.").max(120, "Use no máximo 120 caracteres."),
    emails: z.array(z.email("E-mail inválido.")).max(20, "No máximo 20 destinatários."),
    dias_semana: z
      .array(z.number().int().min(0).max(6))
      .min(1, "Escolha pelo menos um dia da semana.")
      .max(7),
    modo_horario: z.enum(["publicar", "fixos"]),
    horarios: z.array(z.string().regex(REGEX_HORARIO, "Horário inválido.")).max(48, "No máximo 48 horários."),
    dias_retroativos: z
      .string()
      .trim()
      .regex(/^\d+$/, "Informe um número inteiro.")
      .transform(Number)
      .pipe(z.number().int().min(0, "Mínimo 0.").max(30, "Máximo 30 dias.")),
    ativo: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.modo_horario === "fixos" && v.horarios.length === 0) {
      ctx.addIssue({ code: "custom", path: ["horarios"], message: "Adicione pelo menos um horário." });
    }
  });

type CampoErro = "nome" | "emails" | "dias_semana" | "horarios" | "dias_retroativos" | "ativo";

export type ErrosForm = Partial<Record<CampoErro, string>> & {
  filtros?: ErrosFiltros;
};

/**
 * `comConta`: inclui conta_envio_id no payload (só quando a coluna existe no servidor — antes da
 * migration de contas de envio ela não pode ser enviada).
 */
export function validarMonitor(
  form: MonitorForm,
  opcoes: { comConta?: boolean } = {},
):
  | { ok: true; dados: MonitorInput }
  | { ok: false; erros: ErrosForm } {
  const erros: ErrosForm = {};
  const r = dadosSchema.safeParse({
    ...form,
    dias_semana: normalizarDias(form.dias_semana),
    horarios: normalizarHorarios(form.horarios),
  });
  if (!r.success) {
    for (const issue of r.error.issues) {
      const campo = issue.path[0] as CampoErro | undefined;
      if (campo && !erros[campo]) erros[campo] = issue.message;
    }
  }
  const f = validarFiltros({ ...form.filtros, dataInicio: "", dataFim: "" }, "monitor");
  if (!f.ok) erros.filtros = f.erros;
  if (!r.success || !f.ok) return { ok: false, erros };

  return {
    ok: true,
    dados: {
      nome: r.data.nome,
      ...colunasMonitor(f.dados),
      emails: r.data.emails.length ? Array.from(new Set(r.data.emails.map((e) => e.toLowerCase()))) : null,
      dias_semana: r.data.dias_semana,
      horarios: r.data.modo_horario === "fixos" ? r.data.horarios : null,
      dias_retroativos: r.data.dias_retroativos,
      ativo: r.data.ativo,
      ...(opcoes.comConta
        ? { conta_envio_id: /^\d+$/.test(form.conta_envio_id) ? Number(form.conta_envio_id) : null }
        : {}),
    },
  };
}
