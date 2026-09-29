// Mapeamentos do motor:
//   - monitor (filtros combináveis) → parâmetros de GET /api/v1/comunicacao;
//   - monitor → resumo legível dos filtros (e-mail, relatório, logs);
//   - item da API do DJEN → linha de public.comunicacoes.

import { mascararProcessoCnj, somenteDigitos } from './texto.ts';
import type {
  Advogado,
  Destinatario,
  FiltrosMonitor,
  ItemDjen,
  MeioComunicacao,
  NovaComunicacao,
  ParametrosConsulta,
} from './tipos.ts';

// ---------------------------------------------------------------------------
// Monitor → parâmetros da API
// ---------------------------------------------------------------------------

/** trim + espaços internos colapsados; vazio vira null. */
function limpo(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s === '' ? null : s;
}

/**
 * Converte os filtros do monitor nos parâmetros da API. Todos os filtros preenchidos
 * vão juntos (AND) na mesma consulta, como no formulário oficial. Lança Error se inválido
 * (as mesmas regras das constraints da tabela public.monitores).
 */
export function parametrosDoMonitor(m: Partial<FiltrosMonitor>): ParametrosConsulta {
  const p: ParametrosConsulta = {};

  const texto = limpo(m.texto);
  if (texto) {
    if (texto.length < 5) throw new Error('Filtro "texto" precisa de pelo menos 5 caracteres');
    p.texto = texto;
  }

  const sigla = limpo(m.sigla_tribunal)?.toUpperCase();
  if (sigla) p.siglaTribunal = sigla;

  if (m.orgao_id !== null && m.orgao_id !== undefined && String(m.orgao_id).trim() !== '') {
    const orgao = Number(m.orgao_id);
    if (!Number.isInteger(orgao) || orgao <= 0) throw new Error(`Órgão inválido: ${String(m.orgao_id)}`);
    if (!sigla) throw new Error('Filtro por órgão exige o tribunal (sigla_tribunal)');
    p.orgaoId = String(orgao);
  }

  const meio = limpo(m.meio)?.toUpperCase();
  if (meio) {
    if (meio !== 'D' && meio !== 'E') throw new Error(`Meio inválido: ${meio} (use D = Diário ou E = Edital)`);
    p.meio = meio as MeioComunicacao;
  }

  const processoBruto = limpo(m.numero_processo);
  if (processoBruto) {
    const digitos = somenteDigitos(processoBruto);
    if (!digitos) throw new Error('Número de processo inválido');
    p.numeroProcesso = digitos;
  }

  const parte = limpo(m.nome_parte);
  if (parte) {
    if (parte.length < 4) throw new Error('Filtro "nome da parte" precisa de pelo menos 4 caracteres');
    p.nomeParte = parte;
  }

  const advogado = limpo(m.nome_advogado);
  if (advogado) {
    if (advogado.length < 4) throw new Error('Filtro "nome do advogado" precisa de pelo menos 4 caracteres');
    p.nomeAdvogado = advogado;
  }

  const oabBruta = limpo(m.numero_oab);
  const uf = limpo(m.uf_oab)?.toUpperCase();
  if (oabBruta) {
    const numero = oabBruta.replace(/[^0-9a-z]/gi, '').toUpperCase().replace(/^0+(?=\d)/, '');
    if (!numero) throw new Error('Número de OAB inválido');
    p.numeroOab = numero;
  }
  if (uf) {
    if (!/^[A-Z]{2}$/.test(uf)) throw new Error(`UF da OAB inválida: ${uf}`);
    if (!p.numeroOab) throw new Error('UF da OAB informada sem o número da OAB');
    p.ufOab = uf;
  }

  if (!p.texto && !p.siglaTribunal && !p.nomeParte && !p.nomeAdvogado && !p.numeroOab && !p.numeroProcesso) {
    throw new Error(
      'Monitor sem filtro principal: informe ao menos texto, tribunal, parte, advogado, OAB ou nº do processo',
    );
  }
  return p;
}

export const ROTULO_MEIO: Record<MeioComunicacao, string> = { D: 'Diário', E: 'Edital' };

/**
 * Resumo legível dos filtros de um monitor, ex.:
 * "OAB 146444/RJ · TJRJ · 3ª Vara Cível · Diário". Não lança (tolera dados incompletos).
 */
export function resumoFiltros(m: Partial<FiltrosMonitor>): string {
  const partes: string[] = [];
  const oab = limpo(m.numero_oab);
  const uf = limpo(m.uf_oab)?.toUpperCase();
  if (oab) partes.push(`OAB ${oab}${uf ? '/' + uf : ''}`);
  const advogado = limpo(m.nome_advogado);
  if (advogado) partes.push(`Advogado: ${advogado}`);
  const parte = limpo(m.nome_parte);
  if (parte) partes.push(`Parte: ${parte}`);
  const processo = limpo(m.numero_processo);
  if (processo) partes.push(`Processo ${mascararProcessoCnj(somenteDigitos(processo) || processo)}`);
  const texto = limpo(m.texto);
  if (texto) partes.push(`Texto: “${texto.length > 60 ? texto.slice(0, 59) + '…' : texto}”`);
  const sigla = limpo(m.sigla_tribunal)?.toUpperCase();
  if (sigla) partes.push(sigla);
  const orgao = limpo(m.orgao_nome) ?? (m.orgao_id ? `Órgão ${m.orgao_id}` : null);
  if (orgao) partes.push(orgao);
  const meio = limpo(m.meio)?.toUpperCase();
  if (meio) partes.push(ROTULO_MEIO[meio as MeioComunicacao] ?? meio);
  return partes.length ? partes.join(' · ') : 'sem filtros';
}

// ---------------------------------------------------------------------------
// Item da API → comunicação
// ---------------------------------------------------------------------------

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
