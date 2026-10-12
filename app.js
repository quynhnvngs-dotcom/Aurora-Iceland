/* Aurora Iceland – web app theo dõi khả năng ngắm cực quang ở Iceland */
'use strict';

const NOAA = 'https://services.swpc.noaa.gov';
const SRC = {
  kpFc: NOAA + '/products/noaa-planetary-k-index-forecast.json',
  kp1m: NOAA + '/json/planetary_k_index_1m.json',
  mag: NOAA + '/json/rtsw/rtsw_mag_1m.json',
  wind: NOAA + '/json/rtsw/rtsw_wind_1m.json',
  ovation: NOAA + '/json/ovation_aurora_latest.json',
  meteo: 'https://api.open-meteo.com/v1/forecast',
  atlas: 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json',
};
const REYKJAVIK = { lat: 64.146, lon: -21.942 };
const SPOTS = [
  { id: 'rvk', name: 'Reykjavík (Grótta)', short: 'Reykjavík', side: 'l', lat: 64.164, lon: -22.022 },
  { id: 'thing', name: 'Þingvellir', short: 'Þingvellir', dy: -8, lat: 64.256, lon: -21.13 },
  { id: 'kirkju', name: 'Kirkjufell (Snæfellsnes)', short: 'Kirkjufell', lat: 64.942, lon: -23.307 },
  { id: 'hvol', name: 'Hvolsvöllur', short: 'Hvolsvöllur', side: 'l', lat: 63.753, lon: -20.224 },
  { id: 'vik', name: 'Vík', short: 'Vík', lat: 63.419, lon: -19.006 },
  { id: 'klaus', name: 'Kirkjubæjarklaustur', short: 'Klaustur', lat: 63.79, lon: -18.052 },
  { id: 'jokul', name: 'Jökulsárlón', short: 'Jökulsárlón', dy: 14, lat: 64.048, lon: -16.179 },
  { id: 'hofn', name: 'Höfn', short: 'Höfn', lat: 64.254, lon: -15.212 },
  { id: 'egil', name: 'Egilsstaðir', short: 'Egilsstaðir', side: 'l', dy: 16, lat: 65.266, lon: -14.395 },
  { id: 'myvatn', name: 'Mývatn', short: 'Mývatn', dy: 10, lat: 65.604, lon: -16.996 },
  { id: 'aku', name: 'Akureyri', short: 'Akureyri', side: 'l', dy: -6, lat: 65.683, lon: -18.09 },
  { id: 'husa', name: 'Húsavík', short: 'Húsavík', lat: 66.045, lon: -17.338 },
  { id: 'isa', name: 'Ísafjörður', short: 'Ísafjörður', lat: 66.075, lon: -23.124 },
];
const GRID = { latMin: 63.2, latMax: 66.6, latStep: 0.2, lonMin: -24.6, lonMax: -13.4, lonStep: 0.4 };
const VIEW = { lonMin: -24.9, lonMax: -13.1, latMin: 63.1, latMax: 66.7 };
const KX = Math.cos(64.9 * Math.PI / 180);
const MIN = 60e3, HOUR = 36e5;

const S = {
  kpFc: [], kpNow: null, mag: null, wind: null, ovation: null, ovTime: null,
  meteo: null, outline: null, me: null,
  hour: 0, layer: 'eff', fetchedAt: {},
};

/* ---------- tiện ích ---------- */
const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pad2 = (n) => String(n).padStart(2, '0');
const parseUTC = (s) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z');
const num = (v, d = 1) => (v == null || isNaN(v)) ? '—' : Number(v).toLocaleString('vi-VN', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const fmtIS = (d) => `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
const fmtLocal = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const DAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const fmtDayIS = (d) => `${DAYS[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
const tzOffsetMin = -new Date().getTimezoneOffset();
const localTag = (() => {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    if (/Ho_Chi_Minh|Saigon|Bangkok|Hanoi/.test(tz)) return 'VN';
  } catch (_) { /* bỏ qua */ }
  return 'giờ máy';
})();
// Giờ Iceland, kèm giờ trên điện thoại nếu khác múi giờ
const dual = (d) => tzOffsetMin === 0 ? fmtIS(d) : `${fmtIS(d)} (${fmtLocal(d)} ${localTag})`;
const ago = (d) => {
  if (!d) return '';
  const m = Math.round((Date.now() - d.getTime()) / MIN);
  if (m < 1) return 'vừa xong';
  if (m < 60) return `${m} phút trước`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} giờ trước` : `${Math.round(h / 24)} ngày trước`;
};
const lsGet = (k) => { try { return JSON.parse(localStorage.getItem('aur:' + k)); } catch (_) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem('aur:' + k, JSON.stringify(v)); } catch (_) { /* bộ nhớ đầy */ } };

async function getJSON(url, ms = 25000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

/* ---------- đường bờ biển Iceland (world-atlas, Natural Earth) ---------- */
function decodeIceland(topo) {
  const [sx, sy] = topo.transform.scale, [tx, ty] = topo.transform.translate;
  const geom = topo.objects.countries.geometries.find((g) => g.id === '352' || (g.properties && g.properties.name === 'Iceland'));
  if (!geom) return null;
  const arcCache = new Map();
  const arc = (i) => {
    const k = i < 0 ? ~i : i;
    if (!arcCache.has(k)) {
      let x = 0, y = 0;
      arcCache.set(k, topo.arcs[k].map(([dx, dy]) => { x += dx; y += dy; return [x * sx + tx, y * sy + ty]; }));
    }
    const a = arcCache.get(k);
    return i < 0 ? a.slice().reverse() : a;
  };
  const polys = geom.type === 'Polygon' ? [geom.arcs] : geom.arcs;
  const rings = [];
  for (const poly of polys) for (const ring of poly) {
    const pts = [];
    ring.forEach((ai, n) => { const a = arc(ai); pts.push(...(n ? a.slice(1) : a)); });
    rings.push(pts.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]));
  }
  return rings;
}
async function loadOutline() {
  const cached = lsGet('outline');
  if (cached && cached.length) { S.outline = cached; return; }
  try {
    const topo = await getJSON(SRC.atlas, 30000);
    const rings = decodeIceland(topo);
    if (rings) { S.outline = rings; lsSet('outline', rings); }
  } catch (e) { console.warn('Không tải được bờ biển', e); }
}
function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const onLand = (lon, lat) => S.outline ? S.outline.some((r) => inRing(lon, lat, r))
  : ((lon + 18.8) / 6) ** 2 + ((lat - 64.95) / 1.55) ** 2 <= 1;
const nearLand = (lon, lat) => [[0, 0], [0.22, 0], [-0.22, 0], [0, 0.12], [0, -0.12]].some(([dx, dy]) => onLand(lon + dx, lat + dy));

/* ---------- lưới điểm dự báo mây ---------- */
function buildPoints() {
  const rows = Math.round((GRID.latMax - GRID.latMin) / GRID.latStep) + 1;
  const cols = Math.round((GRID.lonMax - GRID.lonMin) / GRID.lonStep) + 1;
  const pts = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const lat = +(GRID.latMin + r * GRID.latStep).toFixed(2), lon = +(GRID.lonMin + c * GRID.lonStep).toFixed(2);
    if (nearLand(lon, lat)) pts.push({ lat, lon, r, c, land: onLand(lon, lat) });
  }
  SPOTS.forEach((s) => pts.push({ lat: s.lat, lon: s.lon, spot: s.id }));
  return { pts, rows, cols };
}

async function fetchMeteo(model) {
  const { pts, rows, cols } = buildPoints();
  const chunks = [];
  for (let i = 0; i < pts.length; i += 90) chunks.push(pts.slice(i, i + 90));
  const vars = 'cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high';
  const results = await Promise.all(chunks.map(async (ch) => {
    const q = new URLSearchParams({
      latitude: ch.map((p) => p.lat).join(','), longitude: ch.map((p) => p.lon).join(','),
      hourly: vars, forecast_days: '3', timezone: 'GMT',
    });
    if (model) q.set('models', model);
    const j = await getJSON(`${SRC.meteo}?${q}`, 40000);
    return Array.isArray(j) ? j : [j];
  }));
  const flat = results.flat();
  const times = flat[0].hourly.time.map((t) => parseUTC(t + ':00').getTime());
  const out = pts.map((p, i) => {
    const h = flat[i].hourly;
    return {
      ...p, total: h.cloud_cover, low: h.cloud_cover_low, mid: h.cloud_cover_mid, high: h.cloud_cover_high,
    };
  });
  return { times, rows, cols, pts: out, model: model || 'best_match', at: Date.now() };
}
async function loadMeteo(force) {
  const cached = S.meteo || lsGet('meteo');
  if (cached && !force && Date.now() - cached.at < 55 * MIN) { S.meteo = cached; return; }
  if (!S.outline) await loadOutline();
  let data = null;
  try { data = await fetchMeteo('dmi_seamless'); } catch (e) { console.warn('DMI lỗi, dùng mô hình mặc định', e); }
  if (!data || !validMeteo(data)) data = await fetchMeteo(null);
  S.meteo = data; lsSet('meteo', data);
}
function validMeteo(d) {
  // Mô hình DMI có thể không phủ hết: cần ít nhất 80% điểm có số liệu giờ hiện tại
  const i = hourIndex(d, Date.now());
  if (i < 0) return false;
  const ok = d.pts.filter((p) => p.total && p.total[i] != null).length;
  return ok / d.pts.length > 0.8;
}
function hourIndex(m, t) {
  if (!m) return -1;
  const h = Math.floor(t / HOUR) * HOUR;
  return m.times.indexOf(h);
}
function cloudOf(p, i, layer = 'eff') {
  if (!p || i < 0) return null;
  const tot = p.total ? p.total[i] : null;
  const pick = (a) => (a && a[i] != null ? a[i] : null);
  const lo = pick(p.low), mi = pick(p.mid), hi = pick(p.high);
  if (layer === 'low') return lo ?? tot;
  if (layer === 'mid') return mi ?? tot;
  if (layer === 'high') return hi ?? tot;
  if (lo == null && mi == null && hi == null) return tot;
  // Mây thấp/giữa che hẳn; mây cao mỏng chỉ che một phần
  return clamp(Math.max(lo ?? 0, mi ?? 0, (hi ?? 0) * 0.5), 0, 100);
}

/* ---------- dữ liệu NOAA ---------- */
function rowsOf(j) {
  if (!Array.isArray(j) || !j.length) return [];
  if (Array.isArray(j[0])) { const [h, ...rest] = j; return rest.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]]))); }
  return j;
}
async function loadKpFc() {
  const rows = rowsOf(await getJSON(SRC.kpFc));
  S.kpFc = rows.map((r) => ({ t: parseUTC(r.time_tag).getTime(), kp: +r.kp, kind: r.observed, scale: r.noaa_scale }))
    .filter((r) => !isNaN(r.kp)).sort((a, b) => a.t - b.t);
  S.fetchedAt.kpFc = Date.now();
  lsSet('kpFc', { at: S.fetchedAt.kpFc, rows: S.kpFc });
}
async function loadKpNow() {
  const rows = rowsOf(await getJSON(SRC.kp1m));
  const last = rows.map((r) => ({ t: parseUTC(r.time_tag), kp: r.estimated_kp != null ? +r.estimated_kp : +r.kp_index }))
    .filter((r) => !isNaN(r.kp)).sort((a, b) => a.t - b.t).pop();
  if (last) S.kpNow = last;
}
function latestActive(rows, field) {
  return rows.filter((r) => r.active !== false && r[field] != null)
    .map((r) => ({ ...r, _t: parseUTC(r.time_tag).getTime() })).sort((a, b) => b._t - a._t);
}
async function loadSolarWind() {
  const [mag, wind] = await Promise.allSettled([getJSON(SRC.mag), getJSON(SRC.wind)]);
  if (mag.status === 'fulfilled') {
    const rows = latestActive(rowsOf(mag.value), 'bz_gsm');
    if (rows.length) {
      const t0 = rows[0]._t, win = rows.filter((r) => r._t >= t0 - 30 * MIN);
      S.mag = { t: new Date(t0), bz: +rows[0].bz_gsm, bt: +rows[0].bt, bzAvg: win.reduce((a, r) => a + +r.bz_gsm, 0) / win.length };
    }
  }
  if (wind.status === 'fulfilled') {
    const rows = latestActive(rowsOf(wind.value), 'proton_speed');
    if (rows.length) {
      const t0 = rows[0]._t, win = rows.filter((r) => r._t >= t0 - 15 * MIN);
      const avg = (k) => { const v = win.map((r) => +r[k]).filter((x) => !isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
      S.wind = { t: new Date(t0), speed: avg('proton_speed'), density: avg('proton_density') };
    }
  }
}
async function loadOvation() {
  const j = await getJSON(SRC.ovation, 40000);
  const map = {};
  for (const [lon, lat, v] of j.coordinates) if (lon >= 330 && lon <= 350 && lat >= 60 && lat <= 70) map[lon + ',' + lat] = v;
  S.ovation = map;
  S.ovTime = parseUTC(j['Forecast Time'] || j['Observation Time']);
}
const ovAt = (lat, lon) => S.ovation ? (S.ovation[`${Math.round((lon + 360) % 360)},${Math.round(lat)}`] ?? null) : null;
function ovIcelandMax() {
  if (!S.ovation) return null;
  let m = 0;
  for (let lon = 336; lon <= 347; lon++) for (let lat = 63; lat <= 66; lat++) m = Math.max(m, S.ovation[lon + ',' + lat] ?? 0);
  return m;
}

/* ---------- chấm điểm khả năng thấy aurora ---------- */
function kpAt(t) {
  const now = Date.now();
  // Gần hiện tại: dùng Kp ước tính theo phút nếu còn mới
  if (S.kpNow && Math.abs(t - now) < 90 * MIN && now - S.kpNow.t.getTime() < 3 * HOUR) return S.kpNow.kp;
  const bin = S.kpFc.find((r) => r.t <= t && t < r.t + 3 * HOUR);
  return bin ? bin.kp : (S.kpNow ? S.kpNow.kp : null);
}
function factorsAt(t, lat, lon, cloud) {
  const date = new Date(t);
  const kp = kpAt(t);
  let geo = kp == null ? 0.3 : clamp((kp - 1) / 4, 0, 1);
  const nowish = Math.abs(t - Date.now()) < 2 * HOUR;
  if (nowish) {
    if (S.mag && Date.now() - S.mag.t < 2 * HOUR) {
      const b = S.mag.bzAvg;
      geo += b <= -10 ? 0.35 : b <= -5 ? 0.2 : b <= -2 ? 0.05 : b >= 5 ? -0.15 : 0;
    }
    if (S.wind && Date.now() - S.wind.t < 2 * HOUR && S.wind.speed) geo += S.wind.speed >= 600 ? 0.1 : S.wind.speed >= 500 ? 0.05 : 0;
    const ov = ovAt(lat, lon);
    if (ov != null && Math.abs(t - Date.now()) < HOUR) geo = Math.max(geo, clamp(ov / 40, 0, 1));
  }
  geo = clamp(geo, 0, 1);
  const sun = Astro.sunAltitude(date, lat, lon);
  const dark = sun <= -12 ? 1 : sun >= -4 ? 0 : (-4 - sun) / 8;
  const mAlt = Astro.moonAltitude(date, lat, lon), mIll = Astro.moonIllumination(date).fraction;
  const moon = mAlt > 0 ? 1 - 0.3 * mIll : 1;
  const clear = cloud == null ? 0.5 : clamp(1 - (cloud - 15) / 85, 0, 1);
  const score = Math.round(100 * geo * dark * clear * moon);
  return { score, geo, dark, clear, moon, kp, cloud, sun };
}
const levelOf = (score, dark) => dark === 0 ? { key: 'low', text: 'Trời chưa tối' }
  : score >= 50 ? { key: 'high', text: 'Cao' } : score >= 25 ? { key: 'mid', text: 'Trung bình' } : { key: 'low', text: 'Thấp' };
const chipClass = (k) => k === 'high' ? 'good' : k === 'mid' ? 'mid' : 'na';

function spotPoint(id) { return S.meteo ? S.meteo.pts.find((p) => p.spot === id) : null; }
function nearestPoint(lat, lon) {
  if (!S.meteo) return null;
  let best = null, bd = Infinity;
  for (const p of S.meteo.pts) {
    if (p.spot) continue;
    const d = ((p.lon - lon) * KX) ** 2 + (p.lat - lat) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  return bd < 0.3 ** 2 ? best : null;
}
// Đánh giá một điểm trong các giờ tới (đêm nay)
function outlook(p, lat, lon, hours = 18) {
  const m = S.meteo, i0 = hourIndex(m, Date.now());
  const series = [];
  for (let k = 0; k <= hours; k++) {
    const i = i0 + k;
    const t = i0 >= 0 && m.times[i] != null ? m.times[i] : Math.floor(Date.now() / HOUR) * HOUR + k * HOUR;
    const tt = k === 0 ? Date.now() : t;
    series.push({ ...factorsAt(tt, lat, lon, cloudOf(p, i)), t: tt });
  }
  const best = series.reduce((a, b) => (b.score > a.score ? b : a), series[0]);
  return { series, best, now: series[0] };
}
function evaluateAll() {
  return SPOTS.map((s) => ({ spot: s, ...outlook(spotPoint(s.id), s.lat, s.lon) }))
    .sort((a, b) => b.best.score - a.best.score);
}

/* ---------- giao diện: tổng quan ---------- */
function renderHome(ev) {
  const hero = $('#hero');
  if (!ev.length) return;
  const top = ev[0], b = top.best, lvl = levelOf(b.score, b.dark);
  hero.dataset.level = lvl.key;
  $('#hero-level').textContent = lvl.text + (b.dark ? ` · ${b.score}/100` : '');
  $('#hero-meter-fill').style.width = clamp(b.score, 2, 100) + '%';
  let txt;
  if (b.score >= 25) {
    txt = `Nơi tốt nhất: ${top.spot.name} lúc ${dual(new Date(b.t))}. Mây khoảng ${num(b.cloud, 0)}%, Kp ${num(b.kp)}.`;
    const others = ev.slice(1, 3).filter((e) => e.best.score >= 25).map((e) => e.spot.short);
    if (others.length) txt += ` Khá tốt: ${others.join(', ')}.`;
  } else {
    const avgClear = ev.reduce((a, e) => a + e.best.clear, 0) / ev.length;
    const reason = avgClear < 0.35 ? 'Mây dày gần như khắp Iceland.'
      : (b.geo < 0.35 ? 'Hoạt động địa từ yếu (Kp thấp).' : 'Điều kiện chưa thuận lợi.');
    txt = `${reason} Khá nhất: ${top.spot.name} lúc ${dual(new Date(b.t))} (${b.score}/100).`;
  }
  $('#hero-text').textContent = txt;

  // Ngay lúc này
  const nowBest = ev.map((e) => ({ e, n: e.now })).sort((a, b2) => b2.n.score - a.n.score)[0];
  const nl = levelOf(nowBest.n.score, nowBest.n.dark);
  $('#now-chip').className = 'chip ' + chipClass(nl.key);
  $('#now-chip').textContent = nl.text + (nowBest.n.dark ? ` ${nowBest.n.score}` : '');
  const sunNow = Astro.sunAltitude(new Date(), REYKJAVIK.lat, REYKJAVIK.lon);
  $('#now-text').textContent = sunNow > -4
    ? `Ở Iceland đang là ${fmtIS(new Date())}, trời còn sáng. Theo dõi lại sau khi trời tối.`
    : `Tốt nhất hiện tại: ${nowBest.e.spot.name} (mây ${num(nowBest.n.cloud, 0)}%). Giờ Iceland: ${fmtIS(new Date())}.`;

  renderFactors();
  renderKpChart();
  renderSky();
}

function factorCard(name, val, unit, chip, note) {
  return `<div class="factor"><div class="f-top"><span class="f-name">${name}</span>${chip ? `<span class="chip ${chip[0]}">${chip[1]}</span>` : ''}</div>
  <div class="f-val">${val}${unit ? `<small>${unit}</small>` : ''}</div><div class="f-note">${note || ''}</div></div>`;
}
function renderFactors() {
  const out = [];
  const stale = (t, mins) => t && Date.now() - t.getTime() > mins * MIN ? ' · <b style="color:var(--warn)">cũ</b>' : '';
  // Kp
  if (S.kpNow) {
    const k = S.kpNow.kp;
    out.push(factorCard('Kp hiện tại', num(k), '', k >= 5 ? ['good', 'Bão từ'] : k >= 3 ? ['good', 'Tốt'] : k >= 2 ? ['mid', 'Vừa'] : ['na', 'Yếu'],
      `ước tính ${ago(S.kpNow.t)}${stale(S.kpNow.t, 30)}`));
  } else out.push(factorCard('Kp hiện tại', '—', '', ['na', '…'], 'đang tải'));
  // Bz
  if (S.mag) {
    const b = S.mag.bzAvg;
    out.push(factorCard('Bz (30 phút)', num(b), 'nT', b <= -5 ? ['good', 'Hướng nam'] : b < 0 ? ['mid', 'Hơi nam'] : ['bad', 'Hướng bắc'],
      `Bt ${num(S.mag.bt)} nT · ${ago(S.mag.t)}${stale(S.mag.t, 30)}`));
  } else out.push(factorCard('Bz (30 phút)', '—', '', ['na', '…'], 'đang tải'));
  // Gió
  if (S.wind && S.wind.speed) {
    const v = S.wind.speed;
    out.push(factorCard('Tốc độ gió Mặt Trời', num(v, 0), 'km/s', v >= 500 ? ['good', 'Nhanh'] : v >= 400 ? ['mid', 'Vừa'] : ['na', 'Chậm'],
      `${ago(S.wind.t)}${stale(S.wind.t, 30)}`));
    const d = S.wind.density;
    out.push(factorCard('Mật độ', num(d), 'p/cm³', d >= 10 ? ['good', 'Cao'] : d >= 5 ? ['mid', 'Vừa'] : ['na', 'Thấp'], 'mật độ cao làm aurora sáng hơn'));
  } else {
    out.push(factorCard('Tốc độ gió Mặt Trời', '—', '', ['na', '…'], 'đang tải'));
    out.push(factorCard('Mật độ', '—', '', ['na', '…'], ''));
  }
  // OVATION
  const ov = ovIcelandMax();
  out.push(factorCard('OVATION trên Iceland', ov == null ? '—' : num(ov, 0), ov == null ? '' : '%',
    ov == null ? ['na', '…'] : ov >= 30 ? ['good', 'Cao'] : ov >= 10 ? ['mid', 'Vừa'] : ['na', 'Thấp'],
    S.ovTime ? `dự báo đến ${fmtIS(S.ovTime)} Iceland` : 'NOAA, 30–90 phút tới'));
  // Mây
  const m = S.meteo, i = hourIndex(m, Date.now());
  if (m && i >= 0) {
    const land = m.pts.filter((p) => p.land);
    const vals = land.map((p) => cloudOf(p, i)).filter((v) => v != null);
    const avg = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
    const clearShare = vals.filter((v) => v < 30).length / (vals.length || 1);
    const bestSpot = SPOTS.map((s) => ({ s, c: cloudOf(spotPoint(s.id), i) })).filter((x) => x.c != null).sort((a, b) => a.c - b.c)[0];
    out.push(factorCard('Mây (cả đảo)', num(avg, 0), '%', avg < 30 ? ['good', 'Quang'] : avg < 70 ? ['mid', 'Rải rác'] : ['bad', 'Nhiều mây'],
      `${num(clearShare * 100, 0)}% diện tích quang${bestSpot ? ` · quang nhất: ${bestSpot.s.short} ${num(bestSpot.c, 0)}%` : ''}`));
  } else out.push(factorCard('Mây (cả đảo)', '—', '', ['na', '…'], 'đang tải'));
  // Bóng tối
  const now = new Date(), sun = Astro.sunAltitude(now, REYKJAVIK.lat, REYKJAVIK.lon);
  out.push(factorCard('Mặt Trời (Reykjavík)', num(sun, 0), '°', sun <= -12 ? ['good', 'Tối'] : sun <= -4 ? ['mid', 'Chạng vạng'] : ['bad', 'Ban ngày'], 'cần dưới −12° để thấy rõ'));
  // Trăng
  const ill = Astro.moonIllumination(now).fraction, mAlt = Astro.moonAltitude(now, REYKJAVIK.lat, REYKJAVIK.lon);
  out.push(factorCard('Mặt Trăng', num(ill * 100, 0), '% sáng', ill <= 0.3 || mAlt <= 0 ? ['good', 'Ít ảnh hưởng'] : ill <= 0.7 ? ['mid', 'Vừa'] : ['bad', 'Sáng'],
    mAlt > 0 ? 'đang ở trên đường chân trời' : 'đang dưới đường chân trời'));
  $('#factors').innerHTML = out.join('');
}

const kpColor = (k) => k >= 7 ? '#d94dff' : k >= 5 ? '#ff6b81' : k >= 4 ? '#ffc857' : k >= 3 ? '#3ee6a1' : k >= 2 ? '#2fa57a' : '#3d5a6e';
const kpWord = (k) => k >= 7 ? 'Bão rất mạnh' : k >= 6 ? 'Bão mạnh' : k >= 5 ? 'Bão từ' : k >= 4 ? 'Hoạt động mạnh' : k >= 3 ? 'Khá tốt' : k >= 2 ? 'Yếu–vừa' : 'Yên tĩnh';
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const dayLabel = (key) => {
  const today = dayKey(Date.now());
  const diff = Math.round((Date.parse(key) - Date.parse(today)) / (24 * HOUR));
  return diff === 0 ? 'Hôm nay' : diff === -1 ? 'Hôm qua' : diff === 1 ? 'Ngày mai' : diff === 2 ? 'Ngày kia' : DAYS[new Date(key).getUTCDay()];
};
const kindText = (k) => k === 'observed' ? 'đã đo' : k === 'estimated' ? 'ước tính' : 'dự báo';
const hh = (t) => pad2(new Date(t).getUTCHours());
const hhLocal = (t) => pad2(new Date(t).getHours());

function renderKpChart() {
  const el = $('#kp-chart'), daysEl = $('#kp-days'), sum = $('#kp-day-sum');
  if (!S.kpFc.length) { el.innerHTML = '<p class="muted small">Chưa tải được dữ liệu Kp.</p>'; daysEl.innerHTML = ''; sum.textContent = ''; return; }
  const now = Date.now();
  // Gom theo ngày (giờ Iceland = UTC)
  const byDay = new Map();
  for (const r of S.kpFc) { const k = dayKey(r.t); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(r); }
  const keys = [...byDay.keys()].sort();
  const today = dayKey(now);
  if (!S.kpDay || !byDay.has(S.kpDay)) S.kpDay = byDay.has(today) ? today : keys[keys.length - 1];

  daysEl.innerHTML = keys.map((k) => {
    const rows = byDay.get(k), mx = Math.max(...rows.map((r) => r.kp));
    const pred = rows.every((r) => r.kind === 'predicted'), d = new Date(k);
    return `<button role="tab" data-day="${k}" class="${k === S.kpDay ? 'on' : ''} ${k === today ? 'today' : ''}" aria-selected="${k === S.kpDay}">
      <span class="dl">${dayLabel(k)}</span><span class="dd">${d.getUTCDate()}/${d.getUTCMonth() + 1}</span>
      <span class="dk" style="color:${kpColor(mx)}">${num(mx)}</span><span class="dt">${pred ? 'dự báo' : 'cao nhất'}</span></button>`;
  }).join('');
  daysEl.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { S.kpDay = b.dataset.day; renderKpChart(); }));
  const sel = daysEl.querySelector('button.on');
  if (sel && !renderKpChart._scrolled) { renderKpChart._scrolled = true; sel.scrollIntoView({ inline: 'center', block: 'nearest' }); }

  // Biểu đồ chi tiết 8 khung 3 giờ của ngày đã chọn
  const day = S.kpDay, base = Date.parse(day + 'T00:00:00Z');
  const slots = Array.from({ length: 8 }, (_, i) => {
    const t = base + i * 3 * HOUR;
    return byDay.get(day).find((r) => r.t === t) || { t, kp: null };
  });
  const W = Math.max(300, el.clientWidth || 340), H = 214, padL = 20, padT = 22, padB = 52;
  const bw = (W - padL) / 8, y = (k) => padT + (H - padT - padB) * (1 - k / 9), y0 = y(0);
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Kp theo giờ ngày ${day}">`;
  // Nền tối: các khung giờ Mặt Trời dưới −6° ở Reykjavík
  slots.forEach((sl, i) => {
    const mid = new Date(sl.t + 1.5 * HOUR);
    if (Astro.sunAltitude(mid, REYKJAVIK.lat, REYKJAVIK.lon) < -6) s += `<rect x="${padL + i * bw}" y="${padT - 18}" width="${bw}" height="${y0 - padT + 18}" fill="rgba(124,140,255,.07)"/>`;
  });
  for (const k of [0, 3, 5, 7, 9]) s += `<line x1="${padL}" x2="${W}" y1="${y(k)}" y2="${y(k)}" stroke="#22304f" stroke-width="1" ${k === 5 ? 'stroke-dasharray="4 3"' : ''}/><text x="2" y="${y(k) + 3}">${k}</text>`;
  slots.forEach((sl, i) => {
    const x = padL + i * bw, cx = x + bw / 2, w = Math.min(30, bw - 8);
    if (sl.kp != null) {
      const op = sl.kind === 'predicted' ? 0.55 : sl.kind === 'estimated' ? 0.8 : 1;
      s += `<rect x="${cx - w / 2}" y="${y(sl.kp)}" width="${w}" height="${Math.max(2, y0 - y(sl.kp))}" rx="4" fill="${kpColor(sl.kp)}" opacity="${op}"${sl.kind === 'predicted' ? ' stroke="' + kpColor(sl.kp) + '" stroke-dasharray="3 2"' : ''}/>`;
      s += `<text x="${cx}" y="${y(sl.kp) - 5}" text-anchor="middle" class="kv">${num(sl.kp)}</text>`;
      if (sl.scale) s += `<text x="${cx}" y="${y(sl.kp) - 17}" text-anchor="middle" class="ks">${sl.scale}</text>`;
    } else s += `<text x="${cx}" y="${y0 - 4}" text-anchor="middle">–</text>`;
    s += `<text x="${cx}" y="${H - 34}" text-anchor="middle" class="hx">${hh(sl.t)}–${pad2((new Date(sl.t).getUTCHours() + 3) % 24)}</text>`;
    if (tzOffsetMin) s += `<text x="${cx}" y="${H - 20}" text-anchor="middle" class="hv">${hhLocal(sl.t)}–${hhLocal(sl.t + 3 * HOUR)}</text>`;
  });
  s += `<text x="${padL}" y="${H - 4}" class="hv">${tzOffsetMin ? `Giờ Iceland / giờ ${localTag === 'VN' ? 'Việt Nam' : 'máy'}` : 'Giờ Iceland'}</text>`;
  if (now >= base && now < base + 24 * HOUR) {
    const x = padL + ((now - base) / (24 * HOUR)) * (W - padL);
    s += `<line x1="${x}" x2="${x}" y1="${padT - 18}" y2="${y0}" stroke="#e8eefc" stroke-dasharray="3 3"/><text x="${clamp(x + 3, 0, W - 44)}" y="${padT - 10}" style="fill:#e8eefc">bây giờ</text>`;
  }
  el.innerHTML = s + '</svg>';

  // Tóm tắt ngày đã chọn
  const valid = slots.filter((x) => x.kp != null);
  if (valid.length) {
    const mx = valid.reduce((a, b) => (b.kp > a.kp ? b : a));
    const night = valid.filter((x) => Astro.sunAltitude(new Date(x.t + 1.5 * HOUR), REYKJAVIK.lat, REYKJAVIK.lon) < -6);
    const nmx = night.length ? night.reduce((a, b) => (b.kp > a.kp ? b : a)) : null;
    const span = (x) => `${hh(x.t)}–${pad2((new Date(x.t).getUTCHours() + 3) % 24)}h`;
    sum.innerHTML = `<b>${dayLabel(day)} ${new Date(day).getUTCDate()}/${new Date(day).getUTCMonth() + 1}:</b> cao nhất Kp <b style="color:${kpColor(mx.kp)}">${num(mx.kp)}</b>${mx.scale ? ' (' + mx.scale + ')' : ''} lúc ${span(mx)} (${kindText(mx.kind)}) · ${kpWord(mx.kp)}.` +
      (nmx ? ` Trong giờ tối: Kp ${num(nmx.kp)} lúc ${span(nmx)}.` : '');
  } else sum.textContent = '';
}

async function loadOutlook27() {
  const r = await fetch(NOAA + '/text/27-day-outlook.txt', { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const txt = await r.text(), M = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const rows = [];
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*(\d{4})\s+([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d+)\s+(\d+)\s+(\d+)/);
    if (m && M[m[2]] != null) rows.push({ t: Date.UTC(+m[1], M[m[2]], +m[3]), ap: +m[5], kp: +m[6] });
  }
  if (rows.length) { S.outlook = rows; lsSet('outlook', { at: Date.now(), rows }); }
}
function renderOutlook() {
  const el = $('#outlook');
  if (!S.outlook || !S.outlook.length) { el.innerHTML = '<p class="muted small">Chưa tải được dự báo dài hạn.</p>'; return; }
  el.innerHTML = S.outlook.map((r) => {
    const d = new Date(r.t);
    return `<div class="cal-d${r.kp >= 4 ? ' hi' : ''}" title="Ap ${r.ap}"><span class="cw">${DAYS[d.getUTCDay()]}</span><span class="cn">${d.getUTCDate()}/${d.getUTCMonth() + 1}</span>
      <span class="ck" style="color:${kpColor(r.kp)}">${r.kp}</span></div>`;
  }).join('');
}

function moonSVG(phase, frac) {
  // Vẽ pha Mặt Trăng: phần sáng màu vàng nhạt
  const r = 18, waxing = phase < 0.5, k = 1 - 2 * frac; // k: 1 = trăng mới, -1 = trăng tròn
  const rx = Math.abs(k) * r, sweepTerm = k > 0 ? (waxing ? 0 : 1) : (waxing ? 1 : 0);
  const outer = waxing ? 1 : 0;
  return `<svg width="40" height="40" viewBox="-20 -20 40 40" aria-hidden="true"><circle r="${r}" fill="#26324d"/>
    <path d="M0 ${-r} A${r} ${r} 0 0 ${outer} 0 ${r} A${rx} ${r} 0 0 ${sweepTerm} 0 ${-r}" fill="#f4e9c1"/></svg>`;
}
function renderSky() {
  const now = new Date();
  const ev = Astro.events(new Date(now.getTime() - 12 * HOUR), REYKJAVIK.lat, REYKJAVIK.lon, 36);
  const ev2 = Astro.events(now, REYKJAVIK.lat, REYKJAVIK.lon, 30);
  const pick = (a, b) => (a && a > new Date(now.getTime() - 10 * HOUR) ? a : b);
  const cell = (label, d) => `<div><b>${d ? dual(d) : '—'}</b><span>${label}</span></div>`;
  const ill = Astro.moonIllumination(now);
  const m = Astro.events(now, REYKJAVIK.lat, REYKJAVIK.lon, 26);
  $('#sky').innerHTML =
    cell('Hoàng hôn', pick(ev.sunset, ev2.sunset)) + cell('Trời tối hẳn (−18°)', pick(ev.darkStart, ev2.darkStart)) +
    cell('Hết tối hẳn', ev2.darkEnd) + cell('Bình minh', ev2.sunrise) +
    `<div class="moon-row">${moonSVG(ill.phase, ill.fraction)}<div><b>Trăng sáng ${num(ill.fraction * 100, 0)}%</b>
    <span>Mọc ${m.moonrise ? dual(m.moonrise) : '—'} · Lặn ${m.moonset ? dual(m.moonset) : '—'}</span></div></div>`;
}

/* ---------- bản đồ mây ---------- */
const canvas = $('#map');
const ctx = canvas.getContext('2d');
let mapGeom = null;
function rampColor(v) {
  // Giống bản đồ vedur.is: trắng = quang, xanh lá đậm dần = nhiều mây
  const stops = [[0, [255, 255, 255, 0]], [25, [180, 240, 140, 0.9]], [50, [60, 210, 60, 0.95]], [75, [10, 156, 20, 1]], [100, [6, 110, 14, 1]]];
  const t = clamp(v, 0, 100);
  for (let k = 1; k < stops.length; k++) {
    if (t <= stops[k][0]) {
      const [a0, c0] = stops[k - 1], [a1, c1] = stops[k], u = (t - a0) / (a1 - a0);
      return c0.map((x, i) => x + (c1[i] - x) * u);
    }
  }
  return stops[stops.length - 1][1];
}
function sizeCanvas() {
  const w = canvas.parentElement.clientWidth || 340;
  const h = Math.round(w * (VIEW.latMax - VIEW.latMin) / ((VIEW.lonMax - VIEW.lonMin) * KX));
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  canvas.style.height = h + 'px';
  mapGeom = { w, h, dpr };
}
const proj = (lon, lat) => [(lon - VIEW.lonMin) / (VIEW.lonMax - VIEW.lonMin) * mapGeom.w, (VIEW.latMax - lat) / (VIEW.latMax - VIEW.latMin) * mapGeom.h];
const unproj = (x, y) => [VIEW.lonMin + x / mapGeom.w * (VIEW.lonMax - VIEW.lonMin), VIEW.latMax - y / mapGeom.h * (VIEW.latMax - VIEW.latMin)];
function landPath() {
  const p = new Path2D();
  if (!S.outline) return null;
  for (const ring of S.outline) ring.forEach(([lon, lat], i) => { const [x, y] = proj(lon, lat); i ? p.lineTo(x, y) : p.moveTo(x, y); });
  p.closePath();
  return p;
}
function drawMap() {
  if (!mapGeom || canvas.parentElement.clientWidth !== mapGeom.w) sizeCanvas();
  const { w, h, dpr } = mapGeom;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#dfe7f0'; ctx.fillRect(0, 0, w, h);
  const land = landPath();
  if (land) { ctx.fillStyle = '#ffffff'; ctx.fill(land, 'evenodd'); }
  const m = S.meteo;
  const i = m ? hourIndex(m, Date.now()) + S.hour : -1;
  if (m && i >= 0 && i < m.times.length) {
    const off = document.createElement('canvas');
    off.width = m.cols; off.height = m.rows;
    const oc = off.getContext('2d'), img = oc.createImageData(m.cols, m.rows);
    for (const p of m.pts) {
      if (p.spot) continue;
      const v = cloudOf(p, i, S.layer);
      if (v == null) continue;
      const [r, g, b, a] = rampColor(v), k = ((m.rows - 1 - p.r) * m.cols + p.c) * 4;
      img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = Math.round(a * 255);
    }
    oc.putImageData(img, 0, 0);
    const [x0, y0] = proj(GRID.lonMin - GRID.lonStep / 2, GRID.latMax + GRID.latStep / 2);
    const [x1, y1] = proj(GRID.lonMin + (m.cols - 0.5) * GRID.lonStep, GRID.latMin - GRID.latStep / 2);
    ctx.save();
    if (land) ctx.clip(land, 'evenodd');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(off, x0, y0, x1 - x0, y1 - y0);
    ctx.restore();
  }
  if (land) { ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1; ctx.stroke(land); }
  else { ctx.fillStyle = '#8b9bbf'; ctx.font = '12px sans-serif'; ctx.fillText('Không tải được đường bờ biển', 10, 18); }

  // Điểm ngắm
  const t = m && i >= 0 && m.times[i] ? m.times[i] : Date.now();
  ctx.font = '600 11px -apple-system, sans-serif';
  for (const s of SPOTS) {
    const p = spotPoint(s.id), f = factorsAt(S.hour === 0 ? Date.now() : t, s.lat, s.lon, cloudOf(p, i));
    const lvl = levelOf(f.score, f.dark).key, [x, y] = proj(s.lon, s.lat);
    ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = lvl === 'high' ? '#7b3fe4' : lvl === 'mid' ? '#ff9f1a' : '#8a94a6'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#ffffff'; ctx.stroke();
    if (w >= 330) {
      const tw = ctx.measureText(s.short).width, ty = y + 4 + (s.dy || 0);
      const tx = clamp(s.side === 'l' ? x - 9 - tw : x + 9, 2, w - tw - 2);
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.strokeText(s.short, tx, ty);
      ctx.fillStyle = '#111'; ctx.fillText(s.short, tx, ty);
    }
  }
  if (S.me) {
    const [x, y] = proj(S.me.lon, S.me.lat);
    ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fillStyle = '#3ab7ff'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
  }
  // Nhãn thời gian
  if (m && i >= 0 && m.times[i]) {
    const d = new Date(S.hour === 0 ? Date.now() : m.times[i]);
    $('#t-label').textContent = `${S.hour === 0 ? 'Bây giờ' : fmtDayIS(d)} · ${fmtIS(d)} giờ Iceland` + (tzOffsetMin ? ` (${fmtLocal(d)} ${localTag})` : '');
    const sl = $('#t-slider'), maxH = Math.max(0, Math.min(48, m.times.length - 1 - hourIndex(m, Date.now())));
    if (+sl.max !== maxH) sl.max = maxH;
    $('#map-model').textContent = (m.model === 'dmi_seamless' ? 'DMI HARMONIE 2 km' : 'Open-Meteo') + ' · ' + ago(new Date(m.at));
  }
}
function mapTap(ev) {
  if (!S.meteo || !mapGeom) return;
  const rect = canvas.getBoundingClientRect();
  const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
  const [lon, lat] = unproj(x, y);
  const p = nearestPoint(lat, lon), tip = $('#map-tip');
  if (!p || !onLand(lon, lat)) { tip.hidden = true; return; }
  const m = S.meteo, i = hourIndex(m, Date.now()) + S.hour;
  const f = factorsAt(S.hour === 0 ? Date.now() : m.times[i], lat, lon, cloudOf(p, i));
  const c = (k) => num(cloudOf(p, i, k), 0);
  tip.innerHTML = `Mây ${c('eff')}% (thấp ${c('low')} · giữa ${c('mid')} · cao ${c('high')})<br>Khả năng: <b>${levelOf(f.score, f.dark).text}</b>${f.dark ? ' ' + f.score : ''}`;
  tip.style.left = clamp(x, 90, mapGeom.w - 90) + 'px'; tip.style.top = y + 'px';
  tip.hidden = false;
  clearTimeout(mapTap._t); mapTap._t = setTimeout(() => { tip.hidden = true; }, 4000);
}


/* ---------- bản đồ mây chính thức (Cục Khí tượng Iceland, vedur.is) ---------- */
const VEDUR = 'https://en.vedur.is/photos/';
const V = { layer: 'isl_skyjahula2', run: null, n: 1, playing: null };
const runCode = (t) => { const d = new Date(t); return `${String(d.getUTCFullYear()).slice(2)}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}_${pad2(d.getUTCHours())}00`; };
const vUrl = (layer, run, n) => `${VEDUR}${layer}/${runCode(run)}_${n}.png`;
const imgOk = (u) => new Promise((res) => { const i = new Image(); i.onload = () => res(true); i.onerror = () => res(false); i.src = u; });
async function findRun() {
  // Mô hình chạy lúc 00, 06, 12, 18 giờ (UTC); ảnh có sau khoảng 2–3 giờ. Thử từ lượt mới nhất trở về trước.
  const last = Math.floor(Date.now() / (6 * HOUR)) * 6 * HOUR;
  for (let k = 0; k < 5; k++) {
    const run = last - k * 6 * HOUR;
    if (await imgOk(vUrl('isl_skyjahula2', run, 72))) return run;
  }
  return null;
}
function vShow() {
  const img = $('#vmap'), msg = $('#vmap-msg');
  if (!V.run) return;
  const t = V.run + V.n * HOUR, d = new Date(t);
  img.onload = () => { msg.hidden = true; };
  img.onerror = () => { msg.hidden = false; msg.textContent = 'Không tải được ảnh giờ này.'; };
  img.src = vUrl(V.layer, V.run, V.n);
  $('#v-slider').value = V.n;
  const now = Date.now(), isNow = Math.abs(t - now) < 30 * MIN;
  $('#v-label').textContent = `${isNow ? 'Bây giờ · ' : ''}${dayLabel(dayKey(t))} ${fmtDayIS(d)} · ${fmtIS(d)} giờ Iceland` + (tzOffsetMin ? ` (${fmtLocal(d)} ${localTag})` : '');
  document.querySelectorAll('#vdays button').forEach((b) => b.classList.toggle('on', b.dataset.day === dayKey(t)));
  // tải trước 3 giờ kế tiếp để kéo mượt
  for (let k = 1; k <= 3; k++) if (V.n + k <= 72) { const p = new Image(); p.src = vUrl(V.layer, V.run, V.n + k); }
}
function vDays() {
  const days = [];
  for (let n = 1; n <= 72; n++) { const k = dayKey(V.run + n * HOUR); if (!days.includes(k)) days.push(k); }
  $('#vdays').innerHTML = days.map((k) => { const d = new Date(k); return `<button data-day="${k}"><b>${dayLabel(k)}</b><span>${d.getUTCDate()}/${d.getUTCMonth() + 1}</span></button>`; }).join('');
  document.querySelectorAll('#vdays button').forEach((b) => b.addEventListener('click', () => {
    // nhảy tới 22h đêm đó (giờ hay ngắm aurora), nếu nằm trong khoảng dự báo
    const target = Date.parse(b.dataset.day + 'T22:00:00Z');
    V.n = clamp(Math.round((target - V.run) / HOUR), 1, 72); vStop(); vShow();
  }));
}
function vStop() { clearInterval(V.playing); V.playing = null; $('#v-play').textContent = '▶'; }
async function initVedurMap(force) {
  if (V.run && !force && Date.now() - V.checked < 30 * MIN) { vShow(); return; }
  $('#vmap-msg').hidden = false; $('#vmap-msg').textContent = 'Đang tìm bản đồ mới nhất…';
  const run = await findRun();
  V.checked = Date.now();
  if (!run) { $('#vmap-msg').textContent = 'Chưa tải được bản đồ của vedur.is. Bấm “Mở trang gốc” bên dưới.'; return; }
  const changed = run !== V.run;
  V.run = run;
  $('#vmap-run').textContent = `Lượt chạy ${fmtDayIS(new Date(run))} ${fmtIS(new Date(run))} · vedur.is`;
  if (changed) { V.n = clamp(Math.round((Date.now() - run) / HOUR), 1, 72); vDays(); }
  vShow();
}
function setupVedurMap() {
  document.querySelectorAll('#vlayer-seg button').forEach((b) => b.addEventListener('click', () => {
    V.layer = b.dataset.layer;
    document.querySelectorAll('#vlayer-seg button').forEach((x) => x.classList.toggle('on', x === b));
    vShow();
  }));
  const sl = $('#v-slider');
  sl.addEventListener('input', () => { V.n = +sl.value; vStop(); vShow(); });
  $('#v-prev').addEventListener('click', () => { V.n = Math.max(1, V.n - 1); vStop(); vShow(); });
  $('#v-next').addEventListener('click', () => { V.n = Math.min(72, V.n + 1); vStop(); vShow(); });
  $('#v-play').addEventListener('click', () => {
    if (V.playing) { vStop(); return; }
    $('#v-play').textContent = '❚❚';
    V.playing = setInterval(() => { V.n = V.n >= 72 ? 1 : V.n + 1; vShow(); }, 700);
  });
}

/* ---------- bảng dự báo mây theo giờ cho từng điểm ngắm ---------- */
function cloudCellColor(v) {
  // trộn với nền trắng để ô ít mây hiện màu trắng như bản đồ gốc
  const [r, g, b, a] = rampColor(v), mix = (x) => Math.round(255 + (x - 255) * a);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}
function renderCloudTable() {
  const el = $('#cf-table'), m = S.meteo;
  if (!m) { el.innerHTML = '<tr><td class="muted small">Đang tải dữ liệu mây…</td></tr>'; return; }
  const i0 = hourIndex(m, Date.now());
  if (i0 < 0) { el.innerHTML = '<tr><td class="muted small">Dữ liệu mây đã cũ, bấm làm mới.</td></tr>'; return; }
  const cols = [];
  for (let k = 0; k < 48 && i0 + k < m.times.length; k++) cols.push(i0 + k);
  const dark = cols.map((i) => Astro.sunAltitude(new Date(m.times[i] + 30 * MIN), REYKJAVIK.lat, REYKJAVIK.lon) < -6);
  let h = '<thead><tr><th class="cf-name">Giờ Iceland</th>' + cols.map((i, n) => {
    const d = new Date(m.times[i]), hr = d.getUTCHours(), newDay = n === 0 || hr === 0;
    return `<th class="${dark[n] ? 'dk' : ''}${newDay ? ' nd' : ''}">${newDay ? `<span class="cf-day">${dayLabel(dayKey(m.times[i]))}</span>` : ''}${pad2(hr)}</th>`;
  }).join('') + '</tr></thead><tbody>';
  for (const s of SPOTS) {
    const p = spotPoint(s.id);
    h += `<tr><th class="cf-name">${s.short}</th>` + cols.map((i, n) => {
      const v = cloudOf(p, i);
      if (v == null) return '<td>·</td>';
      const txt = v >= 55 ? '#fff' : '#0b1a10';
      return `<td class="${dark[n] ? 'dk' : ''}" style="background:${cloudCellColor(v)};color:${txt}">${Math.round(v)}</td>`;
    }).join('') + '</tr>';
  }
  el.innerHTML = h + '</tbody>';
}

/* ---------- điểm ngắm ---------- */
function renderSpots(ev) {
  const el = $('#spot-list');
  if (!ev.length) return;
  el.innerHTML = ev.map((e) => {
    const b = e.best, lvl = levelOf(b.score, b.dark), n = e.now;
    const bars = e.series.map((x) => {
      const l = levelOf(x.score, x.dark).key;
      return `<i class="${l === 'high' ? 'good' : l === 'mid' ? 'mid' : ''}" style="height:${clamp(x.score, 4, 100)}%" title="${fmtIS(new Date(x.t))}: ${x.score}"></i>`;
    }).join('');
    const s0 = e.series[0], sMid = e.series[Math.floor(e.series.length / 2)], sEnd = e.series[e.series.length - 1];
    return `<div class="spot"><div class="spot-head"><span class="spot-name">${e.spot.name}</span>
      <span class="chip ${chipClass(lvl.key)}">${lvl.text}${b.dark ? ' ' + b.score : ''}</span></div>
      <div class="spot-meta"><span>Tốt nhất <b>${dual(new Date(b.t))}</b></span><span>Mây <b>${num(b.cloud, 0)}%</b></span><span>Kp <b>${num(b.kp)}</b></span>
      <span>Bây giờ: mây ${num(n.cloud, 0)}%</span></div>
      <div class="spark">${bars}</div>
      <div class="spark-axis"><span>${fmtIS(new Date(s0.t))}</span><span>${fmtIS(new Date(sMid.t))}</span><span>${fmtIS(new Date(sEnd.t))}</span></div>
      <a class="go" href="https://www.google.com/maps/dir/?api=1&destination=${e.spot.lat},${e.spot.lon}" target="_blank" rel="noopener">Chỉ đường ↗</a></div>`;
  }).join('');
}
const distKm = (a, b) => {
  const R = 6371, rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
function renderMe(ev) {
  if (!S.me) return;
  const p = nearestPoint(S.me.lat, S.me.lon);
  const box = $('#me-text');
  if (!p) {
    box.innerHTML = `Bạn đang ở ngoài vùng bản đồ Iceland (${num(S.me.lat, 2)}, ${num(S.me.lon, 2)}). Khi tới Iceland, mục này sẽ cho biết mây và khả năng thấy aurora ngay chỗ bạn.`;
    return;
  }
  const o = outlook(p, S.me.lat, S.me.lon);
  const ln = levelOf(o.now.score, o.now.dark), lb = levelOf(o.best.score, o.best.dark);
  const near = ev.map((e) => ({ e, d: distKm(S.me, e.spot) })).filter((x) => x.e.best.score >= 50)
    .sort((a, b) => a.d - b.d)[0];
  box.innerHTML = `<b>Ngay chỗ bạn:</b> mây ${num(o.now.cloud, 0)}%, khả năng <b>${ln.text}</b>${o.now.dark ? ' ' + o.now.score : ''}.<br>
    <b>Tối nay tốt nhất:</b> ${dual(new Date(o.best.t))}, khả năng ${lb.text}${o.best.dark ? ' ' + o.best.score : ''}, mây ${num(o.best.cloud, 0)}%.` +
    (near ? `<br><b>Điểm khả năng cao gần nhất:</b> ${near.e.spot.name}, cách ${num(near.d, 0)} km.` : '');
}

/* ---------- cảnh báo ---------- */
const settings = Object.assign({ on: false, th: 50, scope: 'any', last: 0 }, lsGet('settings') || {});
const saveSettings = () => lsSet('settings', settings);
async function notify(title, body) {
  const banner = $('#alert-banner');
  banner.textContent = `🔔 ${title} — ${body}`; banner.hidden = false;
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'aurora', renotify: true });
  } catch (_) {
    try { new Notification(title, { body, icon: 'icons/icon-192.png' }); } catch (__) { /* không hỗ trợ */ }
  }
}
function checkAlert(ev) {
  const banner = $('#alert-banner');
  let target = null;
  if (settings.scope === 'me' && S.me) {
    const p = nearestPoint(S.me.lat, S.me.lon);
    if (p) { const o = outlook(p, S.me.lat, S.me.lon, 0); target = { name: 'chỗ bạn', f: o.now }; }
  } else {
    const b = ev.map((e) => ({ name: e.spot.name, f: e.now })).sort((a, c) => c.f.score - a.f.score)[0];
    if (b) target = b;
  }
  if (!target || target.f.score < settings.th) { banner.hidden = true; return; }
  const body = `${target.name}: ${target.f.score}/100 · Kp ${num(target.f.kp)}${S.mag ? ` · Bz ${num(S.mag.bzAvg)} nT` : ''} · mây ${num(target.f.cloud, 0)}%`;
  if (!settings.on) { banner.textContent = `✨ Đang có khả năng thấy aurora — ${body}`; banner.hidden = false; return; }
  if (Date.now() - settings.last > 90 * MIN) {
    settings.last = Date.now(); saveSettings();
    notify('Aurora: ra ngoài ngắm ngay!', body);
  } else { banner.textContent = `✨ Đang có khả năng thấy aurora — ${body}`; banner.hidden = false; }
}
function setupSettings() {
  const dlg = $('#settings');
  const on = $('#set-on'), th = $('#set-th'), thv = $('#set-th-val'), scope = $('#set-scope'), perm = $('#set-perm');
  const showPerm = () => {
    if (!('Notification' in window)) perm.textContent = 'Để nhận thông báo trên iPhone: cài app lên màn hình chính (Safari → Chia sẻ → Thêm vào MH chính), mở app từ biểu tượng rồi bật lại. Cần iOS 16.4 trở lên.';
    else if (Notification.permission === 'denied') perm.textContent = 'Thông báo đang bị chặn. Bật lại trong Cài đặt iPhone → Thông báo → Aurora.';
    else if (Notification.permission === 'granted') perm.textContent = 'Đã cho phép thông báo.';
    else perm.textContent = '';
  };
  $('#btn-settings').addEventListener('click', () => {
    on.checked = settings.on; th.value = settings.th; thv.textContent = settings.th; scope.value = settings.scope; showPerm();
    dlg.showModal();
  });
  on.addEventListener('change', async () => {
    settings.on = on.checked; saveSettings();
    if (on.checked && 'Notification' in window && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch (_) { /* bỏ qua */ }
    }
    showPerm();
  });
  th.addEventListener('input', () => { thv.textContent = th.value; settings.th = +th.value; saveSettings(); });
  scope.addEventListener('change', () => {
    settings.scope = scope.value; saveSettings();
    if (scope.value === 'me' && !S.me) locate();
  });
  $('#set-test').addEventListener('click', () => notify('Thử cảnh báo aurora', 'Thông báo đang hoạt động.'));
}

/* ---------- vị trí ---------- */
function locate() {
  if (!navigator.geolocation) { $('#me-text').textContent = 'Thiết bị không hỗ trợ định vị.'; return; }
  $('#me-text').textContent = 'Đang lấy vị trí…';
  navigator.geolocation.getCurrentPosition((pos) => {
    S.me = { lat: pos.coords.latitude, lon: pos.coords.longitude };
    lsSet('me', { ...S.me, at: Date.now() });
    renderAll();
  }, (err) => {
    $('#me-text').textContent = err.code === 1 ? 'Bạn chưa cho phép vị trí. Vào Cài đặt iPhone → Quyền riêng tư → Dịch vụ định vị để bật.' : 'Không lấy được vị trí, thử lại sau.';
  }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * MIN });
}

/* ---------- vòng cập nhật ---------- */
function renderAll() {
  const ev = S.meteo ? evaluateAll() : [];
  if (ev.length) { renderHome(ev); renderSpots(ev); renderMe(ev); checkAlert(ev); }
  else { renderFactors(); renderKpChart(); renderSky(); }
  renderOutlook();
  if (!$('#view-map').hidden) { drawMap(); renderCloudTable(); }
  const parts = [];
  const t = Math.max(...Object.values(S.fetchedAt).filter(Boolean), 0);
  if (t) parts.push('Cập nhật ' + fmtLocal(new Date(t)) + (tzOffsetMin ? ` ${localTag}` : ''));
  parts.push('Iceland ' + fmtIS(new Date()));
  if (S.errors && S.errors.length) parts.push('lỗi: ' + S.errors.join(', '));
  $('#updated').textContent = parts.join(' · ');
}
async function refresh(force) {
  const btn = $('#btn-refresh');
  btn.classList.add('spin');
  S.errors = [];
  const task = async (name, fn, key) => {
    try { await fn(); S.fetchedAt[key || name] = Date.now(); } catch (e) { console.warn(name, e); S.errors.push(name); }
  };
  const jobs = [task('gió Mặt Trời', loadSolarWind, 'sw'), task('Kp', loadKpNow, 'kp'), task('OVATION', loadOvation, 'ov')];
  if (force || !S.kpFc.length || Date.now() - (S.fetchedAt.kpFc || 0) > 30 * MIN) jobs.push(task('dự báo Kp', loadKpFc, 'kpFc'));
  jobs.push(task('mây', () => loadMeteo(force), 'meteo'));
  if (force || !S.outlook || Date.now() - (S.fetchedAt.outlook || 0) > 6 * HOUR) jobs.push(task('dự báo 27 ngày', loadOutlook27, 'outlook'));
  await Promise.all(jobs);
  lsSet('rt', { kpNow: S.kpNow, mag: S.mag, wind: S.wind, ovation: S.ovation, ovTime: S.ovTime, at: Date.now() });
  btn.classList.remove('spin');
  renderAll();
}
function restoreCache() {
  const kf = lsGet('kpFc'); if (kf) { S.kpFc = kf.rows; S.fetchedAt.kpFc = kf.at; }
  const ol = lsGet('outlook'); if (ol) { S.outlook = ol.rows; S.fetchedAt.outlook = ol.at; }
  const rt = lsGet('rt');
  if (rt) {
    const d = (x) => x ? new Date(x) : null;
    if (rt.kpNow) S.kpNow = { ...rt.kpNow, t: d(rt.kpNow.t) };
    if (rt.mag) S.mag = { ...rt.mag, t: d(rt.mag.t) };
    if (rt.wind) S.wind = { ...rt.wind, t: d(rt.wind.t) };
    S.ovation = rt.ovation; S.ovTime = d(rt.ovTime);
  }
  S.meteo = lsGet('meteo');
  S.outline = lsGet('outline');
  const me = lsGet('me'); if (me && Date.now() - me.at < 6 * HOUR) S.me = { lat: me.lat, lon: me.lon };
}


/* ---------- camera trực tiếp ---------- */
const YT = (id) => `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&playsinline=1&rel=0`;
const IPCAM = (alias) => `https://g0.ipcamlive.com/player/player.php?alias=${alias}&autoplay=1&mute=1`;
// Camera nhúng được ngay trong app
const CAMS = [
  { id: 'lava', name: 'LAVA Centre – Northern Lights', where: 'Hvolsvöllur · Nam', embed: IPCAM('northernlights'), page: 'https://lavacentre.is/live/northern-lights-web-cam/', note: 'Camera chuyên ngắm aurora, chĩa lên bầu trời.' },
  { id: 'allsky', name: 'Aðaldalshraun – camera toàn trời', where: 'gần Húsavík · Bắc', embed: 'https://www.youtube-nocookie.com/embed/live_stream?channel=UC8XYuAeP8-tigZF88tUcocg&autoplay=1&mute=1&playsinline=1&rel=0', page: 'https://netnurds.com/', note: 'Camera chuyên aurora, nhìn toàn bộ bầu trời (mắt cá).' },
  { id: 'allsky-img', name: 'Aðaldalshraun – ảnh toàn trời', where: 'gần Húsavík · Bắc', img: 'https://netnurds.com/indi-allsky/image.jpg', page: 'https://netnurds.com/', note: 'Ảnh chụp phơi sáng lâu, thấy aurora rõ hơn mắt thường. Tự làm mới mỗi phút.' },
  { id: 'landhotel1', name: 'Landhotel – camera 1', where: 'gần Hella · Nam', embed: IPCAM('6501dd6068492'), page: 'https://landhotel.is/index.php/northernlights-live', note: 'Camera ngắm aurora của khách sạn Landhotel.' },
  { id: 'landhotel2', name: 'Landhotel – camera 2', where: 'gần Hella · Nam', embed: IPCAM('6565ed34e367a'), page: 'https://landhotel.is/index.php/northernlights-live', note: 'Góc nhìn thứ hai của Landhotel.' },
  { id: 'aurora-rvk', name: 'Aurora Reykjavík', where: 'Reykjavík', embed: YT('exshoGpNXZk'), page: 'https://www.youtube.com/watch?v=exshoGpNXZk', note: 'YouTube Live ở Reykjavík.' },
  { id: 'midbakki', name: 'Cảng Miðbakki', where: 'Reykjavík', embed: IPCAM('midbakki'), page: 'https://g0.ipcamlive.com/player/player.php?alias=midbakki', note: 'Bến cảng trung tâm Reykjavík.' },
  { id: 'akureyri', name: 'Vịnh Akureyri', where: 'Akureyri · Bắc', embed: YT('GXTycxKz_FQ'), page: 'https://www.youtube.com/watch?v=GXTycxKz_FQ', note: 'YouTube Live ở miền Bắc, thường ít mây hơn miền Nam.' },
];
// Camera chỉ mở được ở trang riêng (không cho nhúng)
const CAM_LINKS = [
  ['Þingvallavatn', 'Þingvellir', 'thingvallavatn'], ['Skjaldbreiður', 'gần Þingvellir', 'skjaldbreidur'],
  ['Hlíðarfjall', 'Akureyri · Bắc', 'akureyri-hlidarfjall'], ['Stykkishólmur', 'Snæfellsnes · Tây', 'stykkisholmur'],
  ['Hella – Golf', 'Nam Iceland', 'hella-golfvollur'], ['Hekla', 'Nam Iceland', 'hekla'],
  ['Sólheimajökull', 'gần Vík · Nam', 'solheimajokull'], ['Reykjanesviti', 'Bán đảo Reykjanes', 'reykjanesviti'],
  ['Vestmannaeyjar', 'Quần đảo Westman', 'vestmannaeyjar-heimaklettur'],
];
function playCam(id) {
  const c = CAMS.find((x) => x.id === id) || CAMS[0];
  S.cam = c.id; lsSet('cam', c.id);
  $('#cam-name').textContent = c.name;
  $('#cam-where').textContent = c.where;
  $('#cam-open').href = c.page;
  $('#cam-note').textContent = c.note + ' Nếu khung hình báo lỗi (luồng tạm tắt), bấm “Mở riêng”.';
  const f = $('#cam-frame');
  f.innerHTML = '';
  clearInterval(playCam._t);
  if (c.img) {
    const im = document.createElement('img');
    im.alt = 'Ảnh ' + c.name;
    const load = () => { im.src = c.img + '?v=' + Date.now(); };
    im.onerror = () => { f.dataset.err = 'Không tải được ảnh, thử lại sau.'; };
    load();
    playCam._t = setInterval(() => { if (!document.hidden && S.cam === c.id) load(); }, 60e3);
    f.appendChild(im);
    document.querySelectorAll('.cam-tile').forEach((b) => b.classList.toggle('on', b.dataset.cam === c.id));
    return;
  }
  const ifr = document.createElement('iframe');
  ifr.src = c.embed;
  ifr.title = 'Camera ' + c.name;
  ifr.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
  ifr.referrerPolicy = 'strict-origin-when-cross-origin';
  f.appendChild(ifr);
  document.querySelectorAll('.cam-tile').forEach((b) => b.classList.toggle('on', b.dataset.cam === c.id));
}
function setupCams() {
  $('#cam-grid').innerHTML = CAMS.map((c) => `<button class="cam-tile" data-cam="${c.id}">
    <span class="ct-name">${c.name}</span><span class="ct-where">${c.where}</span><span class="ct-live">${c.img ? '● ẢNH MỚI' : '● LIVE'} trong app</span></button>`).join('') +
    `<h3 class="cam-sub">Camera khác · mở trang riêng ↗</h3>` +
    CAM_LINKS.map(([n, w, slug]) => `<a class="cam-tile link" href="https://livefromiceland.is/webcam/${slug}/" target="_blank" rel="noopener">
    <span class="ct-name">${n} ↗</span><span class="ct-where">${w}</span></a>`).join('');
  document.querySelectorAll('button.cam-tile').forEach((b) => b.addEventListener('click', () => { playCam(b.dataset.cam); $('#cam-frame').scrollIntoView({ behavior: 'smooth', block: 'center' }); }));
}

/* ---------- điều hướng ---------- */
function showTab(name) {
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.dataset.view !== name; });
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  if (name === 'map') { sizeCanvas(); drawMap(); renderCloudTable(); initVedurMap(false); }
  if (name !== 'map') vStop();
  if (name === 'home') renderKpChart();
  if (name === 'cams' && !$('#cam-frame iframe')) playCam(CAMS.some((c) => c.id === lsGet('cam')) ? lsGet('cam') : 'lava');
  if (name !== 'cams') { $('#cam-frame').innerHTML = ''; clearInterval(playCam._t); } // dừng video khi rời tab để đỡ tốn dữ liệu
  window.scrollTo({ top: 0 });
  try { history.replaceState(null, '', '#' + name); } catch (_) { /* bỏ qua */ }
}
function setup() {
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('#btn-refresh').addEventListener('click', () => refresh(true));
  $('#btn-locate').addEventListener('click', locate);

  const sl = $('#t-slider');
  sl.addEventListener('input', () => { S.hour = +sl.value; drawMap(); });
  $('#t-prev').addEventListener('click', () => { sl.value = Math.max(0, S.hour - 1); S.hour = +sl.value; drawMap(); });
  $('#t-next').addEventListener('click', () => { sl.value = Math.min(+sl.max, S.hour + 1); S.hour = +sl.value; drawMap(); });
  canvas.addEventListener('click', mapTap);
  window.addEventListener('resize', () => { if (!$('#view-map').hidden) { sizeCanvas(); drawMap(); } renderKpChart(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - (S.fetchedAt.sw || 0) > 4 * MIN) refresh(false);
  });
  setupSettings();
  setupCams();
  setupVedurMap();
  // Gợi ý cài app trên iPhone (Safari, chưa cài)
  const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  if (/iPhone|iPad|iPod/.test(navigator.userAgent) && !standalone && !lsGet('hideInstall')) $('#install-hint').hidden = false;
  $('#hide-install').addEventListener('click', () => { $('#install-hint').hidden = true; lsSet('hideInstall', 1); });
  const tab = location.hash.slice(1);
  if (['home', 'map', 'spots', 'cams'].includes(tab)) showTab(tab);
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  // Có bản cập nhật mới: tải lại trang một lần (không áp dụng cho lần cài đầu tiên)
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
}
restoreCache();
setup();
renderAll();
refresh(false);
setInterval(() => { if (!document.hidden) refresh(false); }, 5 * MIN);
setInterval(() => { if (!document.hidden) renderAll(); }, MIN);
