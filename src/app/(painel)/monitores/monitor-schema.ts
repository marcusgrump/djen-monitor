import { z } from "zod";
import { UFS } from "@/lib/constants";
import { somenteDigitos } from "@/lib/format";
import { TIPOS_MONITOR, type Monitor, type MonitorInput, type TipoMonitor } from "@/lib/types";

/** Estado do formulário (tudo como o usuário digita). */
export interface MonitorForm {
  nome: string;
  tipo: TipoMonitor;
  valor: string;
  uf_oab: string;
  sigla_tribunal: string;
  emails: string[];
  dias_retroativos: string;
  ativo: boolean;
}

export const FORM_VAZIO: MonitorForm = {
  nome: "",
  tipo: "oab",
  valor: "",
  uf_oab: "",
  sigla_tribunal: "",
  emails: [],
  dias_retroativos: "3",
  ativo: true,
};

export function formDeMonitor(m: Monitor): MonitorForm {
  return {
    nome: m.nome,
    tipo: m.tipo,
    valor: m.valor,
    uf_oab: m.uf_oab ?? "",
    sigla_tribunal: m.sigla_tribunal ?? "",
    emails: m.emails ?? [],
    dias_retroativos: String(m.dias_retroativos),
    ativo: m.ativo,
  };
}

export const monitorSchema = z
  .object({
    nome: z.string().trim().min(1, "Informe um nome para o monitor.").max(120, "Use no máximo 120 caracteres."),
    tipo: z.enum(TIPOS_MONITOR, { error: "Escolha o tipo." }),
    valor: z.string().trim().min(1, "Informe o valor a monitorar.").max(300, "Valor longo demais."),
    uf_oab: z.string(),
    sigla_tribunal: z
      .string()
      .trim()
      .toUpperCase()
      .refine((v) => v === "" || /^[A-Z0-9]{2,12}$/.test(v), "Use a sigla do tribunal (ex.: TJSP, TRT2)."),
    emails: z.array(z.email("E-mail inválido.")).max(20, "No máximo 20 destinatários."),
    dias_retroativos: z
      .string()
      .trim()
      .regex(/^\d+$/, "Informe um número inteiro.")
      .transform(Number)
      .pipe(z.number().int().min(0, "Mínimo 0.").max(30, "Máximo 30 dias.")),
    ativo: z.boolean(),
  })
  .superRefine((d, ctx) => {
    if (d.tipo === "oab") {
      if (!(UFS as readonly string[]).includes(d.uf_oab)) {
        ctx.addIssue({ code: "custom", path: ["uf_oab"], message: "Escolha a UF da OAB." });
      }
      if (!/^\d{1,8}[A-Z]?$/i.test(d.valor.replace(/[\s.\-/]/g, ""))) {
        ctx.addIssue({ code: "custom", path: ["valor"], message: "Número da OAB inválido (ex.: 123456)." });
      }
    }
    if (d.tipo === "processo" && somenteDigitos(d.valor).length !== 20) {
      ctx.addIssue({
        code: "custom",
        path: ["valor"],
        message: "O número CNJ tem 20 dígitos (NNNNNNN-DD.AAAA.J.TR.OOOO).",
      });
    }
    if ((d.tipo === "advogado" || d.tipo === "parte" || d.tipo === "texto") && d.valor.length < 3) {
      ctx.addIssue({ code: "custom", path: ["valor"], message: "Use pelo menos 3 caracteres." });
    }
  })
  .transform((d): MonitorInput => {
    let valor = d.valor.replace(/\s+/g, " ").trim();
    if (d.tipo === "processo") valor = somenteDigitos(valor);
    if (d.tipo === "oab") valor = valor.replace(/[\s.\-/]/g, "").toUpperCase();
    return {
      nome: d.nome,
      tipo: d.tipo,
      valor,
      uf_oab: d.tipo === "oab" ? d.uf_oab : null,
      sigla_tribunal: d.sigla_tribunal || null,
      emails: d.emails.length ? Array.from(new Set(d.emails.map((e) => e.toLowerCase()))) : null,
      dias_retroativos: d.dias_retroativos,
      ativo: d.ativo,
    };
  });

export type ErrosForm = Partial<Record<keyof MonitorForm, string>>;

export function validarMonitor(form: MonitorForm):
  | { ok: true; dados: MonitorInput }
  | { ok: false; erros: ErrosForm } {
  const r = monitorSchema.safeParse(form);
  if (r.success) return { ok: true, dados: r.data };
  const erros: ErrosForm = {};
  for (const issue of r.error.issues) {
    const campo = issue.path[0] as keyof MonitorForm | undefined;
    if (campo && !erros[campo]) erros[campo] = issue.message;
  }
  return { ok: false, erros };
}
