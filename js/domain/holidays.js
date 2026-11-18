/* ==========================================================================
   Endereço da empresa (CEP → ViaCEP) e feriados da cidade.

   companies/<id>.addr     = { cep, rua, num, comp, bairro, cidade, uf, ibge }
   companies/<id>.holidays = { ibge, at, years: { 'AAAA': [{ d:'AAAA-MM-DD', n, t, est? }] } }
     t: 'N' nacional | 'E' estadual | 'M' municipal (dia sem expediente) | 'F' ponto facultativo (dia normal)
     est: 1 = previsto (ano ainda sem dados estaduais/municipais publicados; repetido do ano anterior)

   Fontes (gratuitas, com CORS):
   - ViaCEP: endereço + código IBGE da cidade;
   - feriados-brasil (github.com/joaopbini/feriados-brasil, MIT, via jsDelivr): nacionais, estaduais,
     municipais (por código IBGE) e pontos facultativos;
   - BrasilAPI: nacionais de qualquer ano (quando o ano ainda não está no feriados-brasil).
   Os feriados ficam gravados na empresa: todos os membros veem os mesmos dias e a agenda
   (findSlot/fitsAt) não depende de rede para saber se o dia é feriado.
   ========================================================================== */
'use strict';

const VIACEP_URL = 'https://viacep.com.br/ws/';
const HOLIDAY_DATA_URL = 'https://cdn.jsdelivr.net/gh/joaopbini/feriados-brasil@master/dados/feriados/';
const BRASILAPI_HOLIDAYS_URL = 'https://brasilapi.com.br/api/feriados/v1/';
/** Recarrega os feriados gravados depois deste tempo (pega correções e o ano novo publicado). */
const HOLIDAY_REFRESH_MS = 30 * 24 * 60 * MIN;
const HOLIDAY_LABEL = { N: 'Feriado nacional', E: 'Feriado estadual', M: 'Feriado municipal', F: 'Ponto facultativo' };
const HOLIDAY_RANK = { N: 0, E: 1, M: 2, F: 3 };

const onlyDigits = (s) => String(s || '').replace(/\D/g, '');
const formatCep = (s) => { const d = onlyDigits(s).slice(0, 8); return d.length > 5 ? d.slice(0, 5) + '-' + d.slice(5) : d; };

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
  return r.json();
}

// ---------- CEP ----------
/** Endereço do CEP (null se não existir). */
async function lookupCep(cep) {
  const digits = onlyDigits(cep);
  if (digits.length !== 8) return null;
  const data = await fetchJson(VIACEP_URL + digits + '/json/');
  if (!data || data.erro) return null;
  return { cep: formatCep(digits), rua: data.logradouro || '', bairro: data.bairro || '', cidade: data.localidade || '',
    uf: data.uf || '', ibge: String(data.ibge || '') };
}

// ---------- Feriados ----------
/** "25/01/2026" → "2026-01-25". */
const brToKey = (s) => { const [d, m, y] = String(s).split('/'); return y + '-' + m + '-' + d; };

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher), como 'AAAA-MM-DD'. */
function easterKey(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return dateKey(new Date(year, month - 1, day).getTime());
}

/** Feriados móveis (dias em relação à Páscoa), para prever o ano seguinte. */
const MOVABLE_HOLIDAYS = [
  [/quarta.*cinzas/i, -46], [/segunda.*carnaval/i, -48], [/ter[cç]a.*carnaval|^carnaval$/i, -47],
  [/quinta.*santa/i, -3], [/sexta.*(santa|paix[aã]o)/i, -2], [/p[aá]scoa/i, 0], [/corpus christi/i, 60],
];

/** Mesmo feriado no ano `year`: móveis recalculados pela Páscoa, os demais no mesmo dia/mês. */
function projectHoliday(h, year) {
  const movable = MOVABLE_HOLIDAYS.find(([re]) => re.test(h.n));
  if (movable) return { ...h, d: dateKey(addDays(new Date(easterKey(year) + 'T00:00').getTime(), movable[1])), est: 1 };
  return { ...h, d: year + h.d.slice(4), est: 1 };
}

/** Feriados da cidade no ano, pelo feriados-brasil. Lança erro 404 se o ano ainda não foi publicado. */
async function datasetHolidays(year, uf, ibge) {
  const get = (kind) => fetchJson(HOLIDAY_DATA_URL + kind + '/json/' + year + '.json');
  const [nac, est, mun, fac] = await Promise.all(['nacional', 'estadual', 'municipal', 'facultativo'].map(get));
  const item = (t) => (x) => ({ d: brToKey(x.data), n: x.nome, t });
  return [
    ...nac.map(item('N')),
    ...est.filter((x) => x.uf === uf).map(item('E')),
    ...mun.filter((x) => String(x.codigo_ibge) === ibge).map(item('M')),
    // Facultativos: os nacionais (sem UF/cidade) e os da própria cidade.
    ...fac.filter((x) => (!x.uf && !x.codigo_ibge) || String(x.codigo_ibge) === ibge).map(item('F')),
  ];
}

/** Ano ainda sem dados: nacionais pela BrasilAPI + estaduais/municipais/facultativos do ano anterior (previstos). */
async function fallbackHolidays(year, uf, ibge) {
  const nac = await fetchJson(BRASILAPI_HOLIDAYS_URL + year);
  const list = nac.map((x) => ({ d: x.date, n: x.name, t: /carnaval/i.test(x.name) ? 'F' : 'N' }));
  try {
    const prev = await datasetHolidays(year - 1, uf, ibge);
    prev.filter((h) => h.t !== 'N').forEach((h) => list.push(projectHoliday(h, year)));
  } catch (_) { /* sem o ano anterior: só os nacionais */ }
  return list;
}

/** Um registro por dia: vale o de maior peso (nacional > estadual > municipal > facultativo). */
function mergeHolidays(list) {
  const byDay = {};
  for (const h of list) {
    const cur = byDay[h.d];
    if (!cur || HOLIDAY_RANK[h.t] < HOLIDAY_RANK[cur.t]) byDay[h.d] = { d: h.d, n: h.n, t: h.t, ...(h.est ? { est: 1 } : {}) };
  }
  return Object.values(byDay).sort((a, b) => a.d.localeCompare(b.d));
}

/** Feriados da cidade de `addr` para os anos pedidos. */
async function loadHolidays(addr, years) {
  const out = { ibge: addr.ibge, at: Date.now(), years: {} };
  for (const year of years) {
    let list;
    try {
      list = await datasetHolidays(year, addr.uf, addr.ibge);
    } catch (err) {
      if (err.status !== 404) throw err;
      list = await fallbackHolidays(year, addr.uf, addr.ibge);
    }
    out.years[year] = mergeHolidays(list);
  }
  return out;
}

const holidayYears = () => { const y = new Date().getFullYear(); return [y, y + 1]; };

/** Os feriados gravados estão faltando, são de outra cidade ou estão velhos? */
function holidaysStale(company = state.company) {
  const addr = company?.addr;
  if (!addr?.ibge) return false;
  const h = company.holidays;
  return !h || h.ibge !== addr.ibge || holidayYears().some((y) => !h.years?.[y]) || Date.now() - (h.at || 0) > HOLIDAY_REFRESH_MS;
}

let holidaysLoading = false;
let holidaysFailedAt = 0;

/**
 * Busca e grava os feriados da cidade da empresa, se preciso (ou sempre, com `force`).
 * Só quem pode alterar a empresa (administrador e funcionários) grava; falhas de rede tentam de novo em 10 min.
 */
async function ensureHolidays(force = false) {
  const company = state.company;
  if (!company?.addr?.ibge || !(isAdmin() || state.me?.role === 'func')) return false;
  if (holidaysLoading || (!force && (!holidaysStale(company) || Date.now() - holidaysFailedAt < 10 * MIN))) return false;
  holidaysLoading = true;
  try {
    const holidays = await loadHolidays(company.addr, holidayYears());
    if (state.company?.id !== company.id) return false;
    await updateCompany({ holidays });
    return true;
  } catch (err) {
    holidaysFailedAt = Date.now();
    console.warn('Feriados indisponíveis', err);
    if (force) throw err;
    return false;
  } finally {
    holidaysLoading = false;
  }
}

/** Mapa 'AAAA-MM-DD' → feriado, refeito só quando a empresa muda. */
let holidayIndex = { src: null, map: {} };
function holidayMap() {
  const h = state.company?.holidays;
  if (holidayIndex.src !== h) {
    const map = {};
    if (h && h.ibge === state.company?.addr?.ibge) Object.values(h.years || {}).flat().forEach((x) => { map[x.d] = x; });
    holidayIndex = { src: h, map };
  }
  return holidayIndex.map;
}

/** Feriado (ou ponto facultativo) no dia de `ms`, ou null. */
const holidayOn = (ms) => holidayMap()[dateKey(ms)] || null;

/** Dia sem expediente por feriado oficial (ponto facultativo é dia normal de trabalho). */
const isHolidayOff = (ms) => { const h = holidayOn(ms); return !!h && h.t !== 'F'; };

/** "Feriado municipal: Aniversário da Cidade (previsto)". */
const holidayText = (h) => HOLIDAY_LABEL[h.t] + ': ' + h.n + (h.est ? ' (previsto)' : '');

/** Próximos feriados (a partir de hoje). */
function upcomingHolidays(limit = 6) {
  const today = dateKey(Date.now());
  return Object.values(holidayMap()).filter((h) => h.d >= today).sort((a, b) => a.d.localeCompare(b.d)).slice(0, limit);
}

/** Tarefas agendadas do próprio funcionário que caíram em feriado voltam para pendente e são reencaixadas. */
let requeueingHolidays = false;
async function requeueHolidayTasks() {
  if (requeueingHolidays || !state.uid) return;
  const hit = allTasks().filter((t) => t.emp === state.uid && t.status === 'agendada' && t.start && isHolidayOff(t.start));
  if (!hit.length) return;
  requeueingHolidays = true;
  try {
    for (const t of hit) await requeue(t, holidayText(holidayOn(t.start)));
    await scheduleWaiting(state.uid);
  } finally {
    requeueingHolidays = false;
  }
}

/** Mantém os feriados em dia e a agenda fora deles (ao receber a empresa/tarefas e a cada 30 s). */
async function syncHolidays() {
  try {
    await ensureHolidays();
    await requeueHolidayTasks();
  } catch (err) {
    console.warn(err);
  }
}
