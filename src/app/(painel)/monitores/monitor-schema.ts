import { z } from "zod";
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

/** Estado do formulário (tudo como o usuário digita). */
export interface MonitorForm {
  nome: string;
  filtros: FiltrosDjen;
  emails: string[];
  dias_retroativos: string;
  ativo: boolean;
}

export const DIAS_RETROATIVOS_PADRAO = 3;

export const FORM_VAZIO: MonitorForm = {
  nome: "",
  filtros: FILTROS_VAZIOS,
  emails: [],
  dias_retroativos: String(DIAS_RETROATIVOS_PADRAO),
  ativo: true,
};

export function formDeMonitor(m: Monitor): MonitorForm {
  return {
    nome: m.nome,
    filtros: filtrosDeMonitor(m),
    emails: m.emails ?? [],
    dias_retroativos: String(m.dias_retroativos),
    ativo: m.ativo,
  };
}

/** Formulário novo pré-preenchido com filtros (vindos da página Pesquisar). */
export function formDeFiltros(f: FiltrosDjen): MonitorForm {
  const filtros = { ...f, dataInicio: "", dataFim: "" };
  const r = validarFiltros(filtros, "monitor");
  const sugestao = r.ok ? resumoFiltros(r.dados).slice(0, 120) : "";
  return { ...FORM_VAZIO, nome: sugestao, filtros };
}

const dadosSchema = z.object({
  nome: z.string().trim().min(1, "Informe um nome para o monitor.").max(120, "Use no máximo 120 caracteres."),
  emails: z.array(z.email("E-mail inválido.")).max(20, "No máximo 20 destinatários."),
  dias_retroativos: z
    .string()
    .trim()
    .regex(/^\d+$/, "Informe um número inteiro.")
    .transform(Number)
    .pipe(z.number().int().min(0, "Mínimo 0.").max(30, "Máximo 30 dias.")),
  ativo: z.boolean(),
});

export type ErrosForm = Partial<Record<"nome" | "emails" | "dias_retroativos" | "ativo", string>> & {
  filtros?: ErrosFiltros;
};

export function validarMonitor(form: MonitorForm):
  | { ok: true; dados: MonitorInput }
  | { ok: false; erros: ErrosForm } {
  const erros: ErrosForm = {};
  const r = dadosSchema.safeParse(form);
  if (!r.success) {
    for (const issue of r.error.issues) {
      const campo = issue.path[0] as keyof Omit<ErrosForm, "filtros"> | undefined;
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
      dias_retroativos: r.data.dias_retroativos,
      ativo: r.data.ativo,
    },
  };
}
