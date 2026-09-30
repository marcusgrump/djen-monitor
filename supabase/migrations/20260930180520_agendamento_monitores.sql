-- DJEN Monitor — agendamento de envio por monitor
--
-- dias_semana : dias em que o monitor roda e envia (0 = domingo … 6 = sábado, fuso America/Sao_Paulo).
--               Padrão: dias úteis (seg–sex). O DJEN normalmente não publica em fins de semana.
-- horarios    : horários fixos de envio ('HH:MM', só :00 ou :30 — o cron roda a cada 30 min).
--               null/vazio = "assim que publicar": roda em toda execução do cron nos dias escolhidos.
--               Com horários, o monitor roda uma vez por horário (na primeira execução em que
--               hora_atual >= horário) e envia o resumo do que houver de novo.
-- ultimo_envio_agendado : controle interno — último horário agendado já processado.
--
-- O período de busca passa a ser automático: desde a data da última sincronização bem-sucedida
-- (menos 1 dia de folga) até hoje, limitado a 30 dias. dias_retroativos continua existindo e
-- agora só define a janela da PRIMEIRA busca (monitor nunca sincronizado).
--
-- "Sincronizar agora" (origem manual) ignora o agendamento.

alter table public.monitores
  add column dias_semana            smallint[] not null default '{1,2,3,4,5}',
  add column horarios               text[],
  add column ultimo_envio_agendado  timestamptz;

alter table public.monitores
  add constraint monitores_dias_semana_validos check (
    cardinality(dias_semana) between 1 and 7
    and dias_semana <@ array[0,1,2,3,4,5,6]::smallint[]
  ),
  add constraint monitores_horarios_validos check (
    horarios is null
    or cardinality(horarios) = 0
    or (cardinality(horarios) <= 48
        and array_to_string(horarios, ',') ~ '^(([01][0-9]|2[0-3]):(00|30))(,([01][0-9]|2[0-3]):(00|30))*$')
  );

comment on column public.monitores.dias_semana           is 'Dias da semana em que roda/envia (0=dom … 6=sáb, horário de Brasília)';
comment on column public.monitores.horarios              is 'Horários fixos de envio HH:MM (:00/:30); null = assim que publicar (a cada 30 min)';
comment on column public.monitores.ultimo_envio_agendado is 'Controle interno: último horário agendado já processado';
comment on column public.monitores.dias_retroativos      is 'Janela da primeira busca (monitor nunca sincronizado), em dias';
