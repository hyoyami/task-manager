/* ==========================================================================
   Utilitários genéricos: DOM, HTML, datas, formatação, criptografia e imagens.
   Nada aqui conhece regras de negócio.
   ========================================================================== */
'use strict';

/** Milissegundos em um minuto. Durações de tarefa são guardadas em minutos. */
const MIN = 60 * 1000;

// ---------- DOM ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

/** Escapa texto para inserção segura em HTML (conteúdo e atributos). */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/** Retorna `html` se `cond` for verdadeiro, senão string vazia. */
const when = (cond, html) => (cond ? html : '');

/** Mapeia uma lista para HTML e concatena. */
const each = (list, fn) => list.map(fn).join('');

// ---------- Datas ----------
const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
const addDays = (ms, n) => { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); };

/** Combina um dia (ms) com um horário "HH:MM". */
const atTime = (day, hhmm) => {
  const [h, m] = hhmm.split(':');
  const d = new Date(day);
  d.setHours(+h, +m, 0, 0);
  return d.getTime();
};

/** Converte "AAAA-MM-DD" (input date) para o início desse dia, no fuso local. */
const parseDateInput = (value) => new Date(value + 'T00:00').getTime();

// ---------- Formatação (pt-BR) ----------
const fmtTime = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const fmtDay = (ms) => new Date(ms).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
const fmtDayTime = (ms) => fmtDay(ms) + ' ' + fmtTime(ms);
const fmtDateTime = (ms) => new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const plural = (n, one, many) => n + ' ' + (n > 1 ? many : one);

/** "agora", "há 5 min", "há 2 h", "há 3 dias" ou a data. */
function timeAgo(ms) {
  const mins = Math.floor(Math.max(0, Date.now() - ms) / MIN);
  if (mins < 1) return 'agora';
  if (mins < 60) return 'há ' + mins + ' min';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return 'há ' + hours + ' h';
  const days = Math.floor(hours / 24);
  return days < 7 ? 'há ' + plural(days, 'dia', 'dias') : new Date(ms).toLocaleDateString('pt-BR');
}

/** Cor estável (HSL) derivada de um id — usada nos avatares. */
function colorFor(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return 'hsl(' + h + ',55%,42%)';
}

/** Primeira letra do nome, em maiúscula. */
const initial = (name) => (String(name || '?').trim().charAt(0).toUpperCase() || '?');

// ---------- Validação ----------
const isValidEmail = (s) => /^\S+@\S+\.\S+$/.test(s);
const isValidIp = (s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s) && s.split('.').every((x) => +x <= 255);

// ---------- Armazenamento do navegador (pode falhar em modo privado) ----------
const storage = {
  get(key, area = localStorage) { try { return area.getItem(key); } catch (_) { return null; } },
  set(key, value, area = localStorage) { try { area.setItem(key, value); } catch (_) { /* ignorado */ } },
  remove(key, area = localStorage) { try { area.removeItem(key); } catch (_) { /* ignorado */ } },
};

// ---------- Criptografia (Web Crypto) ----------
const toHex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
const randomSalt = () => toHex(crypto.getRandomValues(new Uint8Array(16)));
const sha256 = async (s) => toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

/** Deriva o hash da senha com PBKDF2-SHA256 (150 mil iterações). */
async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 150000, hash: 'SHA-256' }, key, 256);
  return toHex(bits);
}

// ---------- Imagens ----------
/** Lê um arquivo de imagem e devolve um <img> carregado. */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Foto reduzida (lado maior ≤ 800px) em JPEG, como data URL. */
async function readPhoto(file) {
  const img = await loadImage(file);
  const k = Math.min(1, 800 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k);
  c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.72);
}

/** Ícone 64×64 centralizado em PNG, como data URL. */
async function readIcon(file) {
  const img = await loadImage(file);
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const s = Math.min(64 / img.width, 64 / img.height);
  c.getContext('2d').drawImage(img, (64 - img.width * s) / 2, (64 - img.height * s) / 2, img.width * s, img.height * s);
  return c.toDataURL('image/png');
}

const isDataUrl = (s) => typeof s === 'string' && s.startsWith('data:image/');
