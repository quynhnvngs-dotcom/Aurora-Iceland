// Kiểm tra điều kiện aurora ở Iceland và gửi thông báo đẩy tới điện thoại đã đăng ký.
// Chạy bằng GitHub Actions (xem .github/workflows/aurora-push.yml).
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import webpush from 'web-push';

const REPO = process.env.GITHUB_REPOSITORY;
const GH = process.env.GITHUB_TOKEN;
const APP_URL = 'https://quynhnvngs-dotcom.github.io/Aurora-Iceland/';
const NOAA = 'https://services.swpc.noaa.gov';
const MIN = 60e3, HOUR = 36e5;
const STATE_FILE = 'push/state.json';
const DRY = process.env.DRY_RUN === '1';

if (!process.env.VAPID_PRIVATE) { console.error('THIẾU khóa VAPID_PRIVATE: vào Settings → Secrets and variables → Actions → New repository secret.'); process.exit(1); }
webpush.setVapidDetails('mailto:aurora-iceland@users.noreply.github.com', process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE);

// Tính vị trí Mặt Trời/Mặt Trăng: dùng lại astro.js của app
const ctx = { window: {}, Math, Date };
vm.runInNewContext(fs.readFileSync(new URL('../astro.js', import.meta.url), 'utf8'), ctx);
const Astro = ctx.window.Astro;

const SPOTS = [
  ['Reykjavík', 64.164, -22.022], ['Þingvellir', 64.256, -21.13], ['Kirkjufell', 64.942, -23.307],
  ['Hvolsvöllur', 63.753, -20.224], ['Vík', 63.419, -19.006], ['Kirkjubæjarklaustur', 63.79, -18.052],
  ['Jökulsárlón', 64.048, -16.179], ['Höfn', 64.254, -15.212], ['Egilsstaðir', 65.266, -14.395],
  ['Mývatn', 65.604, -16.996], ['Akureyri', 65.683, -18.09], ['Húsavík', 66.045, -17.338], ['Ísafjörður', 66.075, -23.124],
].map(([name, lat, lon]) => ({ name, lat, lon }));

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = (v, d = 1) => Number(v).toLocaleString('vi-VN', { maximumFractionDigits: d });
const parseUTC = (s) => new Date(/[zZ]$/.test(s) ? s : s + 'Z').getTime();
async function getJSON(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'aurora-iceland-push (github.com/' + REPO + ')' } });
  if (!r.ok) throw new Error(url + ' HTTP ' + r.status);
  return r.json();
}
async function gh(path, opts = {}) {
  const r = await fetch('https://api.github.com/repos/' + REPO + path, {
    ...opts, headers: { Authorization: 'Bearer ' + GH, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error('GitHub ' + path + ' HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.status === 204 ? null : r.json();
}

/* ---- dữ liệu ---- */
async function loadSpace() {
  const out = {};
  try {
    const rows = await getJSON(NOAA + '/json/planetary_k_index_1m.json');
    const last = rows.map((r) => ({ t: parseUTC(r.time_tag), kp: r.estimated_kp ?? r.kp_index })).filter((r) => r.kp != null).sort((a, b) => a.t - b.t).pop();
    if (last && Date.now() - last.t < 3 * HOUR) out.kp = +last.kp;
  } catch (e) { console.warn(e.message); }
  try {
    const rows = (await getJSON(NOAA + '/json/rtsw/rtsw_mag_1m.json')).filter((r) => r.active !== false && r.bz_gsm != null)
      .map((r) => ({ t: parseUTC(r.time_tag), bz: +r.bz_gsm, bt: +r.bt })).sort((a, b) => b.t - a.t);
    if (rows.length && Date.now() - rows[0].t < HOUR) {
      const win = rows.filter((r) => r.t >= rows[0].t - 30 * MIN);
      out.bz = win.reduce((a, r) => a + r.bz, 0) / win.length; out.bt = rows[0].bt;
    }
  } catch (e) { console.warn(e.message); }
  try {
    const rows = (await getJSON(NOAA + '/json/rtsw/rtsw_wind_1m.json')).filter((r) => r.active !== false && r.proton_speed != null)
      .map((r) => ({ t: parseUTC(r.time_tag), v: +r.proton_speed, n: +r.proton_density })).sort((a, b) => b.t - a.t);
    if (rows.length && Date.now() - rows[0].t < HOUR) {
      const win = rows.filter((r) => r.t >= rows[0].t - 15 * MIN);
      out.speed = win.reduce((a, r) => a + r.v, 0) / win.length;
    }
  } catch (e) { console.warn(e.message); }
  try {
    const j = await getJSON(NOAA + '/json/ovation_aurora_latest.json');
    out.ov = {};
    for (const [lon, lat, v] of j.coordinates) if (lon >= 330 && lon <= 350 && lat >= 62 && lat <= 68) out.ov[lon + ',' + lat] = v;
  } catch (e) { console.warn(e.message); }
  return out;
}
async function loadClouds() {
  const q = new URLSearchParams({
    latitude: SPOTS.map((s) => s.lat).join(','), longitude: SPOTS.map((s) => s.lon).join(','),
    hourly: 'cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high', forecast_days: '2', timezone: 'GMT', models: 'dmi_seamless',
  });
  const arr = await getJSON('https://api.open-meteo.com/v1/forecast?' + q);
  const h0 = Math.floor(Date.now() / HOUR) * HOUR;
  return arr.map((j) => {
    const h = j.hourly, i = h.time.findIndex((t) => parseUTC(t + ':00') === h0);
    const at = (k) => {
      const lo = h.cloud_cover_low[i + k], mi = h.cloud_cover_mid[i + k], hi = h.cloud_cover_high[i + k];
      return lo == null ? h.cloud_cover[i + k] : clamp(Math.max(lo, mi ?? 0, (hi ?? 0) * 0.5), 0, 100);
    };
    return i < 0 ? null : { now: at(0), next: at(1) };
  });
}

/* ---- chấm điểm (giống app) ---- */
function score(sp, space, cloud) {
  const now = new Date();
  let geo = space.kp == null ? 0.3 : clamp((space.kp - 1) / 4, 0, 1);
  if (space.bz != null) geo += space.bz <= -10 ? 0.35 : space.bz <= -5 ? 0.2 : space.bz <= -2 ? 0.05 : space.bz >= 5 ? -0.15 : 0;
  if (space.speed) geo += space.speed >= 600 ? 0.1 : space.speed >= 500 ? 0.05 : 0;
  const ov = space.ov ? space.ov[`${Math.round((sp.lon + 360) % 360)},${Math.round(sp.lat)}`] ?? null : null;
  if (ov != null) geo = Math.max(geo, clamp(ov / 40, 0, 1));
  geo = clamp(geo, 0, 1);
  const sun = Astro.sunAltitude(now, sp.lat, sp.lon);
  const dark = sun <= -12 ? 1 : sun >= -4 ? 0 : (-4 - sun) / 8;
  const moon = Astro.moonAltitude(now, sp.lat, sp.lon) > 0 ? 1 - 0.3 * Astro.moonIllumination(now).fraction : 1;
  const c = cloud ? Math.min(cloud.now, (cloud.now + cloud.next) / 2) : 50;
  const clear = clamp(1 - (c - 15) / 85, 0, 1);
  return { score: Math.round(100 * geo * dark * clear * moon), geo, dark, cloud: c, ov, sun };
}

/* ---- người đăng ký (GitHub Issues tiêu đề "push-subscribe") ---- */
async function loadSubscribers() {
  const issues = await gh('/issues?state=open&per_page=100');
  const subs = [];
  for (const is of issues) {
    if (is.pull_request || !/^push-subscribe/i.test(is.title)) continue;
    const m = (is.body || '').match(/```(?:json)?\s*([\s\S]*?)```/);
    if (!m) continue;
    try {
      const j = JSON.parse(m[1]);
      if (j.sub && j.sub.endpoint && j.sub.keys) subs.push({ issue: is.number, sub: j.sub, th: clamp(+j.th || 50, 10, 90), id: crypto.createHash('sha1').update(j.sub.endpoint).digest('hex').slice(0, 12) });
    } catch (e) { console.warn('Issue #' + is.number + ' JSON lỗi'); }
  }
  return subs;
}

async function send(s, payload) {
  if (DRY) { console.log('DRY send', s.id, payload.title, '|', payload.body); return true; }
  try {
    await webpush.sendNotification(s.sub, JSON.stringify(payload), { TTL: 1800, urgency: 'high' });
    return true;
  } catch (e) {
    console.warn('Gửi lỗi', s.id, e.statusCode, e.body);
    if (e.statusCode === 404 || e.statusCode === 410) {
      await gh(`/issues/${s.issue}/comments`, { method: 'POST', body: JSON.stringify({ body: 'Thiết bị đã hủy đăng ký thông báo, tự đóng.' }) }).catch(() => {});
      await gh(`/issues/${s.issue}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) }).catch(() => {});
    }
    return false;
  }
}

/* ---- chạy ---- */
const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {};
let changed = false;
const subs = await loadSubscribers();
console.log('Người đăng ký:', subs.length);

// Chào mừng người mới để xác nhận thông báo hoạt động
for (const s of subs) {
  if (state[s.id]) continue;
  const ok = await send(s, { title: 'Đã bật thông báo Aurora 🌌', body: `Bạn sẽ được báo khi khả năng thấy aurora ở Iceland đạt ${s.th}/100, kể cả khi không mở app.`, url: APP_URL, tag: 'aurora-welcome' });
  if (ok) { state[s.id] = { since: Date.now(), last: 0, lastScore: 0 }; changed = true; }
}

const anyDark = SPOTS.some((sp) => Astro.sunAltitude(new Date(), sp.lat, sp.lon) < -6);
if (!anyDark) console.log('Iceland đang sáng, bỏ qua kiểm tra aurora.');
else if (subs.length) {
  const [space, clouds] = await Promise.all([loadSpace(), loadClouds().catch((e) => { console.warn(e.message); return []; })]);
  const ranked = SPOTS.map((sp, i) => ({ sp, ...score(sp, space, clouds[i]) })).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  console.log('Không gian:', JSON.stringify({ kp: space.kp, bz: space.bz, speed: space.speed }), 'Tốt nhất:', best.sp.name, best.score, 'mây', best.cloud);
  // Thời gian gió Mặt Trời đi từ điểm đo L1 (~1,5 triệu km) tới Trái Đất
  const lead = space.speed ? Math.round(1.5e6 / space.speed / 60 / 5) * 5 : null;
  const others = ranked.slice(1, 4).filter((r) => r.score >= 40).map((r) => r.sp.name);
  for (const s of subs) {
    if (best.score < s.th) continue;
    const st = state[s.id] || { last: 0, lastScore: 0 };
    const fresh = Date.now() - st.last > 90 * MIN, jump = best.score >= st.lastScore + 20;
    if (!fresh && !jump) continue;
    const when = best.ov != null && best.ov >= 20 ? 'Aurora có thể đang hiện ngay bây giờ' : lead ? `Khoảng ${Math.max(15, lead)} phút nữa có thể thấy aurora` : 'Có thể thấy aurora trong ít phút tới';
    const lvl = best.score >= 70 ? 'RẤT CAO' : best.score >= 50 ? 'CAO' : 'KHÁ';
    const payload = {
      title: `🌌 Aurora: cơ hội ${lvl} ở ${best.sp.name} (${best.score}/100)`,
      body: `${when}. Mây ${fmt(best.cloud, 0)}%` + (space.kp != null ? `, Kp ${fmt(space.kp)}` : '') + (space.bz != null ? `, Bz ${fmt(space.bz)} nT` : '') +
        `. Ra ngoài, tránh đèn, nhìn về phía Bắc.` + (others.length ? ` Cũng tốt: ${others.join(', ')}.` : ''),
      url: APP_URL, tag: 'aurora-alert',
    };
    if (await send(s, payload)) { state[s.id] = { ...st, last: Date.now(), lastScore: best.score }; changed = true; }
  }
}

if (changed && !DRY) fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1) + '\n');
console.log(changed ? 'Đã cập nhật trạng thái.' : 'Không có gì mới.');
