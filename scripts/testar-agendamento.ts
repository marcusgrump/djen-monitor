// Testes OFFLINE do agendamento por monitor, do período automático de busca e do envio por
// várias contas (sem rede, sem banco: API do DJEN falsa, repositório em memória, relógio falso).
//
//   npx tsx scripts/testar-agendamento.ts
//
// Datas usadas (horário de Brasília): 2026-09-30 = quarta-feira; 2026-10-02 = sexta; 2026-10-03 = sábado.

import assert from 'node:assert/strict';
import { avaliarAgendamento, periodoDeBusca } from '../supabase/functions/_shared/agendamento.ts';
import { ClienteDjen } from '../supabase/functions/_shared/djen-client.ts';
import type { MensagemEmail, RemetenteEmail, TransporteEmail } from '../supabase/functions/_shared/email.ts';
import { RepositorioMemoria } from '../supabase/functions/_shared/repositorio.ts';
import { executarSincronizacao, type OpcoesSync } from '../supabase/functions/_shared/sync.ts';
import type { DetalheMonitor, ItemDjen, Monitor, NovaComunicacao } from '../supabase/functions/_shared/tipos.ts';

// ------------------------------------------------------------------ utilitários
let falhas = 0;
let total = 0;
async function teste(nome: string, fn: () => void | Promise<void>): Promise<void> {
  total++;
  try {
    await fn();
    console.log(`  ok   ${nome}`);
  } catch (e) {
    falhas++;
    console.log(`  FALHA ${nome}\n        ${(e as Error).message.split('\n').join('\n        ')}`);
  }
}

/** Instante em Brasília: br('2026-09-30', '08:03'). */
const br = (data: string, hora: string) => new Date(`${data}T${hora}:00-03:00`);
const QUA = '2026-09-30';
const SEX = '2026-10-02';
const SAB = '2026-10-03';

function monitor(id: number, extra: Partial<Monitor> = {}): Monitor {
  return {
    id,
    nome: `Monitor ${id}`,
    texto: null,
    sigla_tribunal: null,
    orgao_id: null,
    orgao_nome: null,
    meio: null,
    numero_processo: null,
    nome_parte: null,
    nome_advogado: null,
    numero_oab: String(100 + id),
    uf_oab: 'RJ',
    emails: [`m${id}@exemplo.com`],
    ativo: true,
    dias_retroativos: 1,
    ultima_sincronizacao: null,
    ultimo_erro: null,
    dias_semana: [1, 2, 3, 4, 5],
    horarios: null,
    ultimo_envio_agendado: null,
    conta_envio_id: null,
    ...extra,
  };
}

function comunicacao(djenId: number): NovaComunicacao {
  return {
    djen_id: djenId,
    hash: `h${djenId}`,
    numero_comunicacao: djenId,
    data_disponibilizacao: QUA,
    sigla_tribunal: 'TJRJ',
    tipo_comunicacao: 'Intimação',
    tipo_documento: null,
    nome_orgao: '1ª Vara',
    numero_processo: `000000${djenId}`,
    numero_processo_mascara: null,
    nome_classe: null,
    meio: 'D',
    texto: `Texto ${djenId}`,
    link: null,
    destinatarios: [],
    advogados: [],
  };
}

/** Grava comunicações pendentes já vinculadas aos monitores informados. */
async function semear(repo: RepositorioMemoria, djenId: number, monitorIds: number[]): Promise<number> {
  const g = await repo.gravarComunicacoes([comunicacao(djenId)]);
  const id = g.ids.get(djenId)!;
  for (const m of monitorIds) await repo.vincularMonitor(m, [id]);
  return id;
}

/** API do DJEN falsa: itens por numeroOab; registra as URLs pedidas. */
function apiFalsa(itensPorOab: Record<string, ItemDjen[]> = {}, statusPorOab: Record<string, number> = {}) {
  const urls: URL[] = [];
  const fetchFalso: typeof fetch = (input) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    urls.push(url);
    const oab = url.searchParams.get('numeroOab') ?? '';
    const status = statusPorOab[oab] ?? 200;
    if (status !== 200) return Promise.resolve(new Response('{"message":"erro"}', { status }));
    const items = itensPorOab[oab] ?? [];
    return Promise.resolve(
      new Response(JSON.stringify({ status: 'success', count: items.length, items }), {
        status: 200,
        headers: { 'x-ratelimit-limit': '20', 'x-ratelimit-remaining': '19' },
      }),
    );
  };
  const cliente = () =>
    new ClienteDjen({ fetch: fetchFalso, dormir: () => Promise.resolve(), intervaloMinimoMs: 0, maxTentativas: 0 });
  return { urls, cliente };
}

class TransporteFalso implements TransporteEmail {
  enviados: MensagemEmail[] = [];
  falhar = false;
  constructor(readonly nome: string) {}
  enviar(msg: MensagemEmail): Promise<{ id: string }> {
    if (this.falhar) return Promise.reject(new Error('535 falha simulada'));
    this.enviados.push(msg);
    return Promise.resolve({ id: String(this.enviados.length) });
  }
}

function remetente(contaId: number | null, email: string, padrao: boolean): RemetenteEmail & { transporte: TransporteFalso } {
  return { contaId, email, padrao, origem: contaId === null ? 'secrets' : 'painel', transporte: new TransporteFalso(email) };
}

const para = (t: TransporteFalso) => t.enviados.map((m) => m.para.join(','));

function opcoes(
  repo: RepositorioMemoria,
  api: ReturnType<typeof apiFalsa>,
  quando: Date,
  extra: Partial<OpcoesSync> = {},
): OpcoesSync {
  return { repo, cliente: api.cliente(), remetentes: [], origem: 'cron', agora: () => quando, ...extra };
}

const det = (r: { detalhes: Record<string, unknown> }, id: number) => r.detalhes[String(id)] as DetalheMonitor;

// ---------------------------------------------------------------------- testes
async function main() {
  console.log('Elegibilidade (avaliarAgendamento)');

  await teste('dia da semana fora da lista: sábado não roda', () => {
    const av = avaliarAgendamento(monitor(1), br(SAB, '10:00'));
    assert.equal(av.elegivel, false);
    assert.equal(av.motivo, 'sábado não está nos dias escolhidos');
  });

  await teste('dia escolhido incluindo sábado roda', () => {
    const av = avaliarAgendamento(monitor(1, { dias_semana: [6] }), br(SAB, '10:00'));
    assert.equal(av.elegivel, true);
  });

  await teste('sem horários = assim que publicar (roda em toda execução)', () => {
    const av = avaliarAgendamento(monitor(1, { horarios: [] }), br(QUA, '03:30'));
    assert.deepEqual(av, { elegivel: true, motivo: 'assim que publicar', horario: null, marco: null });
  });

  const h = { horarios: ['08:00', '17:30'] };
  await teste('antes do primeiro horário: não roda, informa o próximo', () => {
    const av = avaliarAgendamento(monitor(1, h), br(QUA, '07:30'));
    assert.equal(av.elegivel, false);
    assert.equal(av.motivo, 'próximo envio às 08:00');
  });

  await teste('relógio ligeiramente atrasado (07:59:30) conta como 08:00 (tolerância de 2 min)', () => {
    const av = avaliarAgendamento(monitor(1, h), new Date('2026-09-30T07:59:30-03:00'));
    assert.equal(av.elegivel, true);
    assert.equal(av.horario, '08:00');
  });

  await teste('depois do horário (execução atrasada 08:03): roda uma vez, marco = hoje@08:00', () => {
    const av = avaliarAgendamento(monitor(1, h), br(QUA, '08:03'));
    assert.equal(av.elegivel, true);
    assert.equal(av.horario, '08:00');
    assert.equal(av.marco, '2026-09-30T11:00:00.000Z');
  });

  await teste('horário já processado: não roda de novo às 08:30', () => {
    const av = avaliarAgendamento(monitor(1, { ...h, ultimo_envio_agendado: '2026-09-30T11:00:00.000Z' }), br(QUA, '08:30'));
    assert.equal(av.elegivel, false);
    assert.equal(av.motivo, 'envio das 08:00 já feito; próximo envio às 17:30');
  });

  await teste('processado ontem não bloqueia hoje', () => {
    const av = avaliarAgendamento(monitor(1, { ...h, ultimo_envio_agendado: '2026-09-29T20:30:00.000Z' }), br(QUA, '08:00'));
    assert.equal(av.elegivel, true);
  });

  await teste('vários horários atrasados: processa só o mais recente (12:00), uma vez', () => {
    const m = monitor(1, { horarios: ['12:00', '08:00', '17:30'], ultimo_envio_agendado: '2026-09-29T20:30:00.000Z' });
    const av = avaliarAgendamento(m, br(QUA, '13:10'));
    assert.equal(av.elegivel, true);
    assert.equal(av.horario, '12:00');
    const depois = avaliarAgendamento({ ...m, ultimo_envio_agendado: av.marco }, br(QUA, '13:30'));
    assert.equal(depois.elegivel, false);
    assert.equal(depois.motivo, 'envio das 12:00 já feito; próximo envio às 17:30');
  });

  await teste('último horário do dia feito: informa o próximo dia escolhido', () => {
    const qua = avaliarAgendamento(monitor(1, { ...h, ultimo_envio_agendado: '2026-09-30T20:30:00.000Z' }), br(QUA, '18:00'));
    assert.equal(qua.motivo, 'envio das 17:30 já feito; próximo envio amanhã às 08:00');
    const sex = avaliarAgendamento(monitor(1, { ...h, ultimo_envio_agendado: '2026-10-02T20:30:00.000Z' }), br(SEX, '18:00'));
    assert.equal(sex.motivo, 'envio das 17:30 já feito; próximo envio segunda-feira às 08:00');
  });

  console.log('Período automático (periodoDeBusca)');

  await teste('sem ultima_sincronizacao: hoje - dias_retroativos', () => {
    assert.deepEqual(periodoDeBusca(monitor(1, { dias_retroativos: 3 }), QUA), {
      inicio: '2026-09-27',
      fim: QUA,
      base: 'dias_retroativos',
      limitado: false,
    });
  });

  await teste('com ultima_sincronizacao: data em Brasília - 1 dia (23:30 BRT de 28/09 = 02:30Z de 29/09)', () => {
    const p = periodoDeBusca(monitor(1, { ultima_sincronizacao: '2026-09-29T02:30:00.000Z', dias_retroativos: 10 }), QUA);
    assert.deepEqual(p, { inicio: '2026-09-27', fim: QUA, base: 'ultima_sincronizacao', limitado: false });
  });

  await teste('limite de 30 dias (última sincronização antiga e dias_retroativos grande)', () => {
    const antiga = periodoDeBusca(monitor(1, { ultima_sincronizacao: '2026-06-01T12:00:00.000Z' }), QUA);
    assert.equal(antiga.inicio, '2026-08-31');
    assert.equal(antiga.limitado, true);
    const primeira = periodoDeBusca(monitor(1, { dias_retroativos: 90 }), QUA);
    assert.equal(primeira.inicio, '2026-08-31');
  });

  console.log('Sincronização (executarSincronizacao)');

  await teste('cron sem monitor elegível: termina rápido, sem registro e sem chamar a API', async () => {
    const repo = new RepositorioMemoria({ monitores: [monitor(1)] });
    const api = apiFalsa();
    const r = await executarSincronizacao(opcoes(repo, api, br(SAB, '10:00')));
    assert.equal(r.status, 'sucesso');
    assert.equal(r.execucao_id, null);
    assert.equal(repo.execucoes.length, 0);
    assert.equal(api.urls.length, 0);
    assert.equal(r.pulados, 1);
    assert.match(r.mensagem, /^Nenhum monitor agendado para agora: 1 monitor fora do agendamento \(sábado não está nos dias escolhidos\)\.$/);
    assert.equal(det(r, 1).pulado, 'fora do agendamento');
  });

  await teste('cron: pulados não consomem a API; período automático registrado em detalhes', async () => {
    const repo = new RepositorioMemoria({
      monitores: [
        monitor(1, { horarios: ['17:30'] }),
        monitor(2, { ultima_sincronizacao: '2026-09-29T15:00:00.000Z' }),
      ],
    });
    const api = apiFalsa();
    const r = await executarSincronizacao(opcoes(repo, api, br(QUA, '10:00')));
    assert.equal(r.monitores, 1);
    assert.equal(r.pulados, 1);
    assert.equal(api.urls.length, 1);
    assert.equal(api.urls[0].searchParams.get('numeroOab'), '102');
    assert.equal(api.urls[0].searchParams.get('dataDisponibilizacaoInicio'), '2026-09-28');
    assert.equal(api.urls[0].searchParams.get('dataDisponibilizacaoFim'), QUA);
    assert.deepEqual(det(r, 2).intervalo, { inicio: '2026-09-28', fim: QUA });
    assert.equal(det(r, 1).motivo, 'próximo envio às 17:30');
    assert.equal(repo.execucoes.length, 1);
  });

  await teste('manual ignora o agendamento e não altera ultimo_envio_agendado', async () => {
    const repo = new RepositorioMemoria({ monitores: [monitor(1, { horarios: ['08:00'] })] });
    const api = apiFalsa({ '101': [{ id: 900, data_disponibilizacao: SAB, siglaTribunal: 'TJRJ', texto: 'x' }] });
    const conta = remetente(1, 'padrao@exemplo.com', true);
    const r = await executarSincronizacao(
      opcoes(repo, api, br(SAB, '10:00'), { origem: 'manual', monitorId: 1, remetentes: [conta] }),
    );
    assert.equal(r.monitores, 1);
    assert.equal(r.novas, 1);
    assert.equal(conta.transporte.enviados.length, 1);
    assert.equal(repo.monitores[0].ultimo_envio_agendado, null);
    assert.equal(det(r, 1).agendamento, 'manual (ignora o agendamento)');
  });

  await teste('notificação só dos monitores processados; comunicação compartilhada espera o horário do outro', async () => {
    const repo = new RepositorioMemoria({
      monitores: [
        monitor(1, { horarios: ['17:30'], emails: ['a@exemplo.com'] }),
        monitor(2, { emails: ['b@exemplo.com'] }),
      ],
      configuracoes: { emails_recebem_tudo: ['todos@exemplo.com'] },
    });
    const c1 = await semear(repo, 1, [1]);
    const c2 = await semear(repo, 2, [2]);
    const c3 = await semear(repo, 3, [1, 2]);
    const api = apiFalsa();
    const conta = remetente(1, 'padrao@exemplo.com', true);

    const r1 = await executarSincronizacao(opcoes(repo, api, br(QUA, '10:00'), { remetentes: [conta] }));
    assert.equal(r1.status, 'sucesso', r1.mensagem);
    assert.deepEqual(para(conta.transporte).sort(), ['b@exemplo.com', 'todos@exemplo.com']);
    const notif = (id: number) => repo.comunicacoes.find((c) => c.id === id)!.notificada_em !== null;
    assert.equal(notif(c1), false, 'c1 (só do monitor 1) espera as 17:30');
    assert.equal(notif(c2), true);
    assert.equal(notif(c3), false, 'c3 ainda falta para a@ (monitor 1 fora do horário)');
    assert.equal(r1.email.pendentes, 2);

    conta.transporte.enviados = [];
    const r2 = await executarSincronizacao(opcoes(repo, api, br(QUA, '17:31'), { remetentes: [conta] }));
    assert.equal(r2.status, 'sucesso', r2.mensagem);
    // a@ recebe c1 e c3 num e-mail; todos@ recebe só c1 (c3 já tinha ido); b@ nada
    assert.deepEqual(para(conta.transporte).sort(), ['a@exemplo.com', 'todos@exemplo.com']);
    const paraTodos = conta.transporte.enviados.find((m) => m.para[0] === 'todos@exemplo.com')!;
    assert.match(paraTodos.assunto, /1 nova comunicação/);
    assert.equal(notif(c1) && notif(c3), true);
    assert.equal(repo.monitores[0].ultimo_envio_agendado, '2026-09-30T20:30:00.000Z');
    assert.equal(det(r2, 1).horario_concluido, true);
    // sem duplicatas: cada (comunicação, destinatário) uma vez
    const chaves = repo.envios.map((e) => `${e.comunicacao_id}|${e.destinatario}`);
    assert.equal(new Set(chaves).size, chaves.length);
    assert.equal(repo.envios.length, 7); // c1: a,todos · c2: b,todos · c3: b,todos (10:00) + a (17:31)
  });

  await teste('falha no envio não avança o horário; a próxima execução tenta de novo', async () => {
    const repo = new RepositorioMemoria({ monitores: [monitor(1, { horarios: ['08:00'] })] });
    await semear(repo, 10, [1]);
    const api = apiFalsa();
    const conta = remetente(1, 'padrao@exemplo.com', true);
    conta.transporte.falhar = true;
    const r1 = await executarSincronizacao(opcoes(repo, api, br(QUA, '08:05'), { remetentes: [conta] }));
    assert.equal(r1.status, 'parcial');
    assert.equal(repo.monitores[0].ultimo_envio_agendado, null);
    assert.equal(det(r1, 1).horario_concluido, false);
    assert.equal(r1.email.contas[0].falhas.length, 1);

    conta.transporte.falhar = false;
    const r2 = await executarSincronizacao(opcoes(repo, api, br(QUA, '08:30'), { remetentes: [conta] }));
    assert.equal(r2.monitores, 1, 'ainda elegível para o horário das 08:00');
    assert.equal(r2.email.enviados, 1);
    assert.equal(repo.monitores[0].ultimo_envio_agendado, '2026-09-30T11:00:00.000Z');
    const r3 = await executarSincronizacao(opcoes(repo, api, br(QUA, '09:00'), { remetentes: [conta] }));
    assert.equal(r3.execucao_id, null, 'já processado: nada a fazer');
  });

  await teste('erro na busca não avança o horário', async () => {
    const repo = new RepositorioMemoria({ monitores: [monitor(1, { horarios: ['08:00'] })] });
    const api = apiFalsa({}, { '101': 400 });
    const r = await executarSincronizacao(opcoes(repo, api, br(QUA, '08:01'), { remetentes: [remetente(1, 'p@exemplo.com', true)] }));
    assert.equal(r.status, 'erro');
    assert.equal(repo.monitores[0].ultimo_envio_agendado, null);
  });

  await teste('várias contas: remetente por monitor, "recebem tudo" pela conta do 1º monitor, falha isolada', async () => {
    const repo = new RepositorioMemoria({
      monitores: [
        monitor(1, { emails: ['a@exemplo.com', 'comum@exemplo.com'], conta_envio_id: 10 }),
        monitor(2, { emails: ['b@exemplo.com', 'comum@exemplo.com'], conta_envio_id: 99 }), // 99 inexistente -> padrão
      ],
      configuracoes: { emails_recebem_tudo: ['todos@exemplo.com'] },
    });
    await semear(repo, 20, [1]);
    await semear(repo, 21, [2]);
    await semear(repo, 22, [1, 2]);
    const padrao = remetente(1, 'padrao@exemplo.com', true);
    const conta10 = remetente(10, 'escritorio@exemplo.com', false);
    const api = apiFalsa();
    const r = await executarSincronizacao(opcoes(repo, api, br(QUA, '10:00'), { remetentes: [padrao, conta10] }));
    assert.equal(r.status, 'sucesso', r.mensagem);
    // conta 10: a@ (20,22), comum@ (20,22 — 1º monitor que inclui é o 1), todos@ (20,22)
    assert.deepEqual(para(conta10.transporte).sort(), ['a@exemplo.com', 'comum@exemplo.com', 'todos@exemplo.com']);
    // padrão: b@ (21,22), comum@ (21), todos@ (21)
    assert.deepEqual(para(padrao.transporte).sort(), ['b@exemplo.com', 'comum@exemplo.com', 'todos@exemplo.com']);
    assert.equal(r.email.notificadas, 3);
    assert.deepEqual(
      r.email.contas.map((c) => [c.conta_id, c.enviados]),
      [
        [1, 3],
        [10, 3],
      ],
    );

    // falha só na conta 10: a padrão continua; o que era da conta 10 fica pendente
    const repo2 = new RepositorioMemoria({ monitores: repo.monitores.map((m) => ({ ...m })) });
    await semear(repo2, 30, [1]);
    await semear(repo2, 31, [2]);
    const p2 = remetente(1, 'padrao@exemplo.com', true);
    const c10 = remetente(10, 'escritorio@exemplo.com', false);
    c10.transporte.falhar = true;
    const r2 = await executarSincronizacao(opcoes(repo2, api, br(QUA, '10:00'), { remetentes: [p2, c10] }));
    assert.equal(r2.status, 'parcial');
    assert.deepEqual(para(p2.transporte).sort(), ['b@exemplo.com', 'comum@exemplo.com']);
    assert.equal(repo2.comunicacoes.find((c) => c.djen_id === 30)!.notificada_em, null);
    assert.notEqual(repo2.comunicacoes.find((c) => c.djen_id === 31)!.notificada_em, null);
    assert.ok(r2.email.contas[1].falhas.length >= 1);
  });

  await teste('limite de e-mails por execução: excedente fica pendente e o horário não conclui', async () => {
    const repo = new RepositorioMemoria({
      monitores: [monitor(1, { horarios: ['08:00'], emails: ['a@exemplo.com', 'b@exemplo.com'] })],
    });
    await semear(repo, 40, [1]);
    const conta = remetente(1, 'p@exemplo.com', true);
    const api = apiFalsa();
    const r = await executarSincronizacao(
      opcoes(repo, api, br(QUA, '08:00'), { remetentes: [conta], maxEmailsPorExecucao: 1 }),
    );
    assert.equal(conta.transporte.enviados.length, 1);
    assert.equal(repo.comunicacoes[0].notificada_em, null);
    assert.equal(repo.monitores[0].ultimo_envio_agendado, null);
    const r2 = await executarSincronizacao(
      opcoes(repo, api, br(QUA, '08:30'), { remetentes: [conta], maxEmailsPorExecucao: 1 }),
    );
    assert.equal(conta.transporte.enviados.length, 2);
    assert.notEqual(repo.comunicacoes[0].notificada_em, null);
    assert.equal(repo.monitores[0].ultimo_envio_agendado, '2026-09-30T11:00:00.000Z');
    assert.ok(r.mensagem.includes('Limite de 1 e-mail(s)') && r2.status === 'sucesso');
  });

  await teste('órfãs (sem monitor) nunca são enviadas, não travam a fila e são contadas', async () => {
    const repo = new RepositorioMemoria({
      monitores: [monitor(1)],
      configuracoes: { emails_recebem_tudo: ['todos@exemplo.com'] },
    });
    await semear(repo, 50, []);
    await semear(repo, 51, [1]);
    const conta = remetente(1, 'p@exemplo.com', true);
    const r = await executarSincronizacao(opcoes(repo, apiFalsa(), br(QUA, '10:00'), { remetentes: [conta] }));
    assert.equal(r.email.orfas, 1);
    assert.equal(r.email.pendentes, 1);
    assert.equal(repo.comunicacoes.find((c) => c.djen_id === 50)!.notificada_em, null);
    assert.notEqual(repo.comunicacoes.find((c) => c.djen_id === 51)!.notificada_em, null);
  });

  await teste('sem destinatário: aviso e continua pendente', async () => {
    const repo = new RepositorioMemoria({ monitores: [monitor(1, { emails: [] })] });
    await semear(repo, 60, [1]);
    const conta = remetente(1, 'p@exemplo.com', true);
    const r = await executarSincronizacao(opcoes(repo, apiFalsa(), br(QUA, '10:00'), { remetentes: [conta] }));
    assert.equal(r.email.sem_destinatario, 1);
    assert.match(r.mensagem, /Recebem tudo/);
    assert.equal(conta.transporte.enviados.length, 0);
  });

  await teste('dry-run: não grava, não envia, simula o envio', async () => {
    const repo = new RepositorioMemoria({ monitores: [monitor(1, { horarios: ['08:00'] })] });
    await semear(repo, 70, [1]);
    const conta = remetente(1, 'p@exemplo.com', true);
    const r = await executarSincronizacao(
      opcoes(repo, apiFalsa(), br(QUA, '08:10'), { remetentes: [conta], dryRun: true }),
    );
    assert.equal(r.execucao_id, null);
    assert.equal(repo.execucoes.length, 0);
    assert.equal(conta.transporte.enviados.length, 0);
    assert.deepEqual(r.email.simulacao, { emails: 1, destinatarios: 1, comunicacoes: 1 });
    assert.equal(repo.monitores[0].ultimo_envio_agendado, null);
    assert.equal(repo.comunicacoes[0].notificada_em, null);
  });

  console.log(`\n${total - falhas}/${total} testes ok`);
  if (falhas) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
