// Conversão de itens da API do DJEN para linhas de public.comunicacoes.

import { mascararProcessoCnj } from './texto.ts';
import type { Advogado, Destinatario, ItemDjen, NovaComunicacao } from './tipos.ts';

function txt(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Normaliza a data para 'YYYY-MM-DD' (aceita também 'DD/MM/YYYY'). */
function dataIso(item: ItemDjen): string | null {
  const bruto = txt(item.data_disponibilizacao) ?? txt(item.datadisponibilizacao);
  if (!bruto) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(bruto);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(bruto);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

export function itemParaComunicacao(item: ItemDjen): NovaComunicacao {
  const destinatarios: Destinatario[] = (Array.isArray(item.destinatarios) ? item.destinatarios : [])
    .map((d) => ({ nome: txt(d?.nome) ?? '', polo: txt(d?.polo) }))
    .filter((d) => d.nome !== '');

  const vistos = new Set<string>();
  const advogados: Advogado[] = [];
  for (const da of Array.isArray(item.destinatarioadvogados) ? item.destinatarioadvogados : []) {
    const a = da?.advogado;
    const nome = txt(a?.nome);
    if (!nome) continue;
    const adv: Advogado = { nome, numero_oab: txt(a?.numero_oab), uf_oab: txt(a?.uf_oab) };
    const chave = `${adv.nome}|${adv.numero_oab}|${adv.uf_oab}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    advogados.push(adv);
  }

  const numeroProcesso = txt(item.numero_processo);
  return {
    djen_id: Number(item.id),
    hash: txt(item.hash),
    numero_comunicacao: numero(item.numeroComunicacao),
    data_disponibilizacao: dataIso(item),
    sigla_tribunal: txt(item.siglaTribunal),
    tipo_comunicacao: txt(item.tipoComunicacao),
    tipo_documento: txt(item.tipoDocumento),
    nome_orgao: txt(item.nomeOrgao),
    numero_processo: numeroProcesso,
    numero_processo_mascara: txt(item.numeroprocessocommascara) ?? mascararProcessoCnj(numeroProcesso),
    nome_classe: txt(item.nomeClasse),
    meio: txt(item.meio),
    texto: typeof item.texto === 'string' ? item.texto : null,
    link: txt(item.link),
    destinatarios,
    advogados,
  };
}
