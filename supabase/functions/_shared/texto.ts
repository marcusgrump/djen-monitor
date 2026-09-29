// Utilitários de texto: limpeza do HTML das comunicações, entidades e escape.

// Nomes HTML4 para os códigos 160..255 (Latin-1), na ordem.
const LATIN1 =
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml'.split(
    ' ',
  );

const ENTIDADES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  sbquo: '‚',
  ldquo: '“',
  rdquo: '”',
  bdquo: '„',
  bull: '•',
  hellip: '…',
  euro: '€',
  trade: '™',
  ordm: 'º',
  ordf: 'ª',
};
LATIN1.forEach((nome, i) => {
  ENTIDADES[nome] = String.fromCharCode(160 + i);
});

export function decodificarEntidades(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (inteiro, ent: string) => {
    if (ent[0] === '#') {
      const cod = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      if (!Number.isFinite(cod) || cod <= 0 || cod > 0x10ffff) return inteiro;
      try {
        return String.fromCodePoint(cod);
      } catch {
        return inteiro;
      }
    }
    return ENTIDADES[ent] ?? ENTIDADES[ent.toLowerCase()] ?? inteiro;
  });
}

/** Converte o HTML da comunicação em texto corrido legível. */
export function htmlParaTexto(html: string | null | undefined): string {
  if (!html) return '';
  let s = String(html);
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(head|style|script|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|section|article|header|footer|tr|table|h[1-6]|li|ul|ol)\s*>/gi, '\n');
  s = s.replace(/<\/t[dh]\s*>/gi, ' ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodificarEntidades(s);
  s = s.replaceAll(String.fromCharCode(160), ' '); // NBSP -> espaço
  s = s.replace(/[ \t\f\v\r]+/g, ' ');
  s = s.replace(/ *\n */g, '\n');
  s = s.replace(/\n{2,}/g, '\n');
  return s.trim();
}

/** Trecho de até `max` caracteres, cortado em fronteira de palavra, em uma linha. */
export function trecho(textoPlano: string, max = 600): string {
  const t = textoPlano.replace(/\s*\n\s*/g, ' · ').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const corte = t.slice(0, max);
  const ultimoEspaco = corte.lastIndexOf(' ');
  return (ultimoEspaco > max * 0.7 ? corte.slice(0, ultimoEspaco) : corte).replace(/[\s,;:.·-]+$/, '') + '…';
}

export function escaparHtml(s: string | number | null | undefined): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function somenteDigitos(s: string): string {
  return s.replace(/\D/g, '');
}

/** Formata 20 dígitos CNJ como NNNNNNN-DD.AAAA.J.TR.OOOO */
export function mascararProcessoCnj(numero: string | null | undefined): string | null {
  if (!numero) return null;
  const d = somenteDigitos(numero);
  if (d.length !== 20) return numero;
  return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16)}`;
}

export function urlValida(u: string | null | undefined): string | null {
  if (!u) return null;
  const s = u.trim();
  return /^https?:\/\/\S+$/i.test(s) ? s : null;
}
