import { createStore } from "./store.js";
import { members } from "./config.js";
import { DEFAULT_CATEGORIES, PALETTE } from "./categories.js";
import { resizeImage, readReceipt } from "./receipt.js";

// ---------- Durum ----------
const S = {
  store: null,
  user: null,
  expenses: [],
  categories: DEFAULT_CATEGORIES,
  settings: {},
  loaded: false,
  range: loadPref("range", { preset: "month" }),
  filter: { cat: "", who: "", q: "" },
};
let unsubs = [];
let installPrompt = null;

// ---------- Yardımcılar ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (n) => money.format(n || 0);
const moneyRound = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 });
const fmtShort = (n) => moneyRound.format(n || 0);
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseIso = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const todayIso = () => iso(new Date());
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const MONTHS_SHORT = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const DAYS = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
const fmtDay = (s) => { const d = parseIso(s); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const fmtDayLong = (s) => {
  if (s === todayIso()) return "Bugün";
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (s === iso(y)) return "Dün";
  const d = parseIso(s);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${DAYS[d.getDay()]}`;
};
const parseAmount = (v) => {
  // "1.234,56" ve "1234.56" biçimlerinin ikisini de kabul et.
  let s = String(v).trim().replace(/\s|₺/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};
const amountInput = (n) => (n ? String(n).replace(".", ",") : "");

function loadPref(key, def) {
  try { return JSON.parse(localStorage.getItem("eg-" + key)) || def; } catch { return def; }
}
function savePref(key, val) {
  try { localStorage.setItem("eg-" + key, JSON.stringify(val)); } catch {}
}

const UNKNOWN_CAT = { id: "?", name: "Silinmiş kategori", icon: "❔", color: "#94a3b8", subs: [] };
const getCat = (id) => S.categories.find((c) => c.id === id) || UNKNOWN_CAT;

function toast(msg, type = "") {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "show " + type;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.className = ""), 2800);
}

// Tarayıcının confirm/prompt pencereleri yerine uygulamanın kendi onay penceresi.
function ask({ title, text = "", input = null, ok = "Tamam", danger = false }) {
  return new Promise((resolve) => {
    const root = $("#dialog-root");
    root.innerHTML = `<div class="modal-backdrop top"><form class="modal dialog" role="alertdialog" aria-modal="true">
      <div class="modal-body stack">
        <h2>${esc(title)}</h2>
        ${text ? `<p class="muted">${esc(text)}</p>` : ""}
        ${input ? `<input id="ask-input" value="${esc(input.value || "")}" placeholder="${esc(input.placeholder || "")}" maxlength="40">` : ""}
        <div class="modal-actions"><span class="grow"></span>
          <button type="button" class="btn ghost" id="ask-no">Vazgeç</button>
          <button type="submit" class="btn ${danger ? "danger" : "primary"}">${esc(ok)}</button></div>
      </div></form></div>`;
    const done = (v) => { root.innerHTML = ""; resolve(v); };
    const inp = $("#ask-input", root);
    setTimeout(() => (inp || $("button[type=submit]", root)).focus(), 30);
    $("#ask-no", root).onclick = () => done(input ? null : false);
    $("form", root).onsubmit = (e) => { e.preventDefault(); done(input ? inp.value.trim() || null : true); };
    $(".modal-backdrop", root).onkeydown = (e) => { if (e.key === "Escape") { e.stopPropagation(); done(input ? null : false); } };
  });
}

// ---------- Tarih aralığı ----------
const PRESETS = [
  ["month", "Bu ay"], ["lastMonth", "Geçen ay"], ["last3", "Son 3 ay"],
  ["year", "Bu yıl"], ["all", "Tümü"], ["custom", "Tarih seç"],
];

function currentRange() {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  switch (S.range.preset) {
    case "month": return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
    case "lastMonth": return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case "last3": return { from: iso(new Date(y, m - 2, 1)), to: iso(new Date(y, m + 1, 0)) };
    case "year": return { from: `${y}-01-01`, to: `${y}-12-31` };
    case "custom": return { from: S.range.from || iso(new Date(y, m, 1)), to: S.range.to || todayIso() };
    default: {
      const dates = S.expenses.map((e) => e.date).sort();
      return { from: dates[0] || todayIso(), to: dates[dates.length - 1] || todayIso(), all: true };
    }
  }
}

function rangeLabel(r) {
  const a = parseIso(r.from), b = parseIso(r.to);
  if (a.getDate() === 1 && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear() &&
      b.getDate() === new Date(b.getFullYear(), b.getMonth() + 1, 0).getDate()) {
    return `${MONTHS[a.getMonth()]} ${a.getFullYear()}`;
  }
  return `${fmtDay(r.from)} – ${fmtDay(r.to)}`;
}

const inRange = (e, r) => e.date >= r.from && e.date <= r.to;

function previousRange(r) {
  const a = parseIso(r.from), b = parseIso(r.to);
  // Tam ay seçiliyse bir önceki tam ayla, değilse aynı uzunluktaki önceki dönemle karşılaştır.
  if (a.getDate() === 1 && b.getDate() === new Date(b.getFullYear(), b.getMonth() + 1, 0).getDate()) {
    const months = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth() + 1;
    return { from: iso(new Date(a.getFullYear(), a.getMonth() - months, 1)), to: iso(new Date(a.getFullYear(), a.getMonth(), 0)) };
  }
  const days = Math.round((b - a) / 864e5) + 1;
  const pb = new Date(a); pb.setDate(pb.getDate() - 1);
  const pa = new Date(pb); pa.setDate(pa.getDate() - days + 1);
  return { from: iso(pa), to: iso(pb) };
}

// ---------- Başlangıç ----------
async function start() {
  try {
    S.store = await createStore();
  } catch (err) {
    console.error(err);
    $("#app").innerHTML = `<div class="center-msg"><h2>Bağlantı kurulamadı</h2><p>İnternet bağlantınızı kontrol edip sayfayı yenileyin.</p></div>`;
    return;
  }
  S.store.onAuth((user) => {
    unsubs.forEach((u) => u());
    unsubs = [];
    S.user = user;
    S.loaded = false;
    if (user) {
      unsubs.push(S.store.watchExpenses((list, sync) => {
        S.expenses = list; S.loaded = true; S.sync = sync || {}; S.syncError = null;
        renderSyncBadge(); renderView();
      }, (err) => {
        console.error(err);
        S.syncError = err?.code || "bilinmeyen";
        S.loaded = true;
        renderSyncBadge(); renderView();
        toast(S.syncError.includes("permission") ? "Bu hesabın verilere erişim izni yok" : "Buluta bağlanılamadı", "error");
      }));
      unsubs.push(S.store.watchCategories((list) => { S.categories = list && list.length ? list : DEFAULT_CATEGORIES; renderView(); }));
      unsubs.push(S.store.watchSettings((s) => { S.settings = s || {}; }));
    }
    render();
  });
  window.addEventListener("hashchange", render);
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; });
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

const route = () => (location.hash.replace("#", "") || "ozet");

function render() {
  const app = $("#app");
  if (!S.user) return renderLogin(app);
  const r = route();
  const nav = [
    ["ozet", "Özet", ICONS.home],
    ["harcamalar", "Harcamalar", ICONS.list],
    ["ayarlar", "Ayarlar", ICONS.gear],
  ];
  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand"><img src="icons/icon-192.png" alt=""><span>Ev Giderleri</span></div>
        <button class="btn primary block" data-act="add">${ICONS.plus} Harcama ekle</button>
        <button class="btn soft block" data-act="receipt">${ICONS.camera} Fiş tara</button>
        <nav>${nav.map(([id, label, ic]) => `<a href="#${id}" class="${r === id ? "active" : ""}">${ic}<span>${label}</span></a>`).join("")}</nav>
        <div class="sidebar-user">${avatar(S.user.name)}<div><b>${esc(S.user.name)}</b><small>${esc(S.user.email)}</small></div></div>
      </aside>
      <main class="main">
        <header class="topbar">
          <h1>${{ ozet: "Özet", harcamalar: "Harcamalar", ayarlar: "Ayarlar" }[r] || "Özet"}</h1>
          <div class="topbar-right">
            <span id="sync-badge"></span>
            ${S.store.mode === "demo" ? `<span class="badge warn" title="Veriler yalnızca bu cihazda tutuluyor">Deneme modu</span>` : ""}
            <span class="topbar-user">${avatar(S.user.name)}</span>
          </div>
        </header>
        ${r !== "ayarlar" ? `<div class="rangebar" id="rangebar"></div>` : ""}
        <section id="view"></section>
      </main>
      <nav class="tabbar">
        <a href="#ozet" class="${r === "ozet" ? "active" : ""}">${ICONS.home}<span>Özet</span></a>
        <a href="#harcamalar" class="${r === "harcamalar" ? "active" : ""}">${ICONS.list}<span>Harcamalar</span></a>
        <button class="fab" data-act="add" aria-label="Harcama ekle">${ICONS.plus}</button>
        <button data-act="receipt">${ICONS.camera}<span>Fiş tara</span></button>
        <a href="#ayarlar" class="${r === "ayarlar" ? "active" : ""}">${ICONS.gear}<span>Ayarlar</span></a>
      </nav>
    </div>`;
  $$("[data-act=add]", app).forEach((b) => b.onclick = () => openExpenseModal());
  $$("[data-act=receipt]", app).forEach((b) => b.onclick = () => openReceiptModal());
  renderSyncBadge();
  renderView();
}

// Buluta bağlantı durumunu üst çubukta gösterir: çevrimdışı, gönderiliyor ya da hata.
function renderSyncBadge() {
  const el = $("#sync-badge");
  if (!el || S.store.mode !== "cloud") return;
  const st = S.syncError ? ["error", "Bağlantı hatası"]
    : S.sync?.pending ? ["warn", "Gönderiliyor…"]
    : S.sync?.offline ? ["warn", "Çevrimdışı"]
    : ["ok", "Senkron"];
  el.className = "badge " + st[0];
  el.textContent = st[1];
  el.title = S.syncError ? "Hata: " + S.syncError : "";
}

function renderView() {
  const view = $("#view");
  if (!view || !S.user) return;
  const r = route();
  if (r !== "ayarlar") renderRangeBar();
  if (!S.loaded && r !== "ayarlar") {
    view.innerHTML = `<div class="center-msg"><div class="spinner"></div></div>`;
    return;
  }
  if (r === "harcamalar") renderExpenses(view);
  else if (r === "ayarlar") renderSettings(view);
  else renderSummary(view);
}

function avatar(name) {
  const i = members.findIndex((m) => m.name === name);
  return `<span class="avatar a${i < 0 ? 2 : i}" title="${esc(name)}">${esc((name || "?").charAt(0).toLocaleUpperCase("tr"))}</span>`;
}

// ---------- Giriş ----------
function renderLogin(app) {
  const demo = S.store.mode === "demo";
  app.innerHTML = `
    <div class="login">
      <div class="login-card">
        <img src="icons/icon-192.png" alt="" class="login-logo">
        <h1>Ev Giderleri</h1>
        <p class="muted">Evin tüm harcamaları, iki kişi, tek liste.</p>
        ${demo ? `
          <p class="note">Bu kopya henüz buluta bağlı değil. Denemek için kim olduğunuzu seçin; veriler yalnızca bu cihazda kalır.</p>
          <div class="stack">${members.map((m) => `<button class="btn primary block" data-email="${esc(m.email)}">${esc(m.name)} olarak devam et</button>`).join("")}</div>
        ` : `
          <form id="login-form" class="stack">
            <div class="seg" role="tablist">
              <label><input type="radio" name="mode" value="in" checked><span>Giriş yap</span></label>
              <label><input type="radio" name="mode" value="up"><span>Hesap oluştur</span></label>
            </div>
            <label>E-posta<input type="email" name="email" id="login-email" autocomplete="username" required></label>
            <label>Şifre<input type="password" name="password" id="login-password" autocomplete="current-password" minlength="6" required></label>
            <p class="muted small" id="login-hint" hidden>İlk kez kullanıyorsan e-postanı ve kendine bir şifre (en az 6 karakter) yaz. Yalnızca ${members.map((m) => esc(m.name)).join(" ve ")} hesap açabilir.</p>
            <button class="btn primary block" type="submit">Giriş yap</button>
            <p class="error" id="login-error"></p>
            <button type="button" class="btn ghost small" id="forgot">Şifremi unuttum</button>
          </form>`}
      </div>
    </div>`;
  if (demo) {
    $$("[data-email]", app).forEach((b) => b.onclick = () => S.store.signIn(b.dataset.email));
    return;
  }
  const form = $("#login-form");
  const btn = $("button[type=submit]", form);
  const err = $("#login-error");
  const mode = () => $("input[name=mode]:checked", form).value;
  $$("input[name=mode]", form).forEach((r) => r.onchange = () => {
    const up = mode() === "up";
    btn.textContent = up ? "Hesap oluştur" : "Giriş yap";
    $("#login-hint").hidden = !up;
    $("#forgot").hidden = up;
    $("#login-password").autocomplete = up ? "new-password" : "current-password";
    err.textContent = "";
  });
  $("#forgot").onclick = async () => {
    const email = $("#login-email").value.trim();
    if (!email) return (err.textContent = "Önce e-postanı yaz, sonra Şifremi unuttum'a bas.");
    try {
      await S.store.resetPassword(email);
      toast("Şifre yenileme bağlantısı e-postana gönderildi", "ok");
    } catch { err.textContent = "Bağlantı gönderilemedi. E-postayı kontrol et."; }
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const email = f.get("email").trim();
    const up = mode() === "up";
    err.textContent = "";
    if (up && !members.some((m) => m.email.toLowerCase() === email.toLowerCase())) {
      return (err.textContent = "Bu e-posta uygulamayı kullanabilecek kişiler arasında değil.");
    }
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = up ? "Hesap açılıyor…" : "Giriş yapılıyor…";
    try {
      await (up ? S.store.signUp(email, f.get("password")) : S.store.signIn(email, f.get("password")));
    } catch (e2) {
      const code = e2?.code || "";
      err.textContent =
        code.includes("email-already-in-use") ? "Bu e-postayla zaten hesap var. Giriş yap sekmesini kullan." :
        code.includes("admin-restricted-operation") ? "Yeni hesap açma kapalı. Hesabın varsa Giriş yap sekmesini kullan." :
        code.includes("weak-password") ? "Şifre en az 6 karakter olmalı." :
        code.includes("operation-not-allowed") || code.includes("configuration-not-found") ? "Firebase'de Email/Password girişi henüz açılmamış." :
        code.includes("network") ? "İnternet bağlantısı yok." :
        up ? "Hesap açılamadı. Tekrar dene." : "E-posta veya şifre hatalı.";
      btn.disabled = false;
      btn.textContent = label;
    }
  };
}

// ---------- Tarih çubuğu ----------
function renderRangeBar() {
  const bar = $("#rangebar");
  if (!bar) return;
  const r = currentRange();
  bar.innerHTML = `
    <div class="chips scroll">${PRESETS.map(([id, label]) =>
      `<button class="chip ${S.range.preset === id ? "on" : ""}" data-preset="${id}">${label}</button>`).join("")}</div>
    ${S.range.preset === "custom" ? `
      <div class="custom-range">
        <label><span>Başlangıç</span><input type="date" id="r-from" value="${r.from}"></label>
        <label><span>Bitiş</span><input type="date" id="r-to" value="${r.to}"></label>
      </div>` : `<div class="range-label">${esc(rangeLabel(r))}</div>`}`;
  $$("[data-preset]", bar).forEach((b) => b.onclick = () => {
    S.range = { ...S.range, preset: b.dataset.preset };
    if (b.dataset.preset === "custom" && !S.range.from) {
      const cr = currentRange();
      S.range.from = cr.from; S.range.to = cr.to;
    }
    savePref("range", S.range);
    renderView();
  });
  if (S.range.preset === "custom") {
    const onChange = () => {
      let from = $("#r-from").value, to = $("#r-to").value;
      if (!from || !to) return;
      if (from > to) [from, to] = [to, from];
      S.range = { preset: "custom", from, to };
      savePref("range", S.range);
      renderView();
    };
    $("#r-from").onchange = onChange;
    $("#r-to").onchange = onChange;
  }
}

// ---------- Özet sayfası ----------
function renderSummary(view) {
  const r = currentRange();
  const list = S.expenses.filter((e) => inRange(e, r));
  const total = sum(list);
  const prev = r.all ? null : sum(S.expenses.filter((e) => inRange(e, previousRange(r))));
  const days = Math.max(1, Math.round((Math.min(parseIso(r.to), parseIso(todayIso())) - parseIso(r.from)) / 864e5) + 1);

  const byWho = members.map((m) => ({ name: m.name, total: sum(list.filter((e) => e.who === m.name)) }));
  const others = total - byWho.reduce((a, b) => a + b.total, 0);
  if (others > 0.001) byWho.push({ name: "Diğer", total: others });

  const byCat = groupBy(list, (e) => e.categoryId)
    .map(([id, items]) => ({ cat: getCat(id), total: sum(items), count: items.length, subs: groupBy(items, (e) => e.sub).map(([s, it]) => ({ name: s, total: sum(it) })).sort((a, b) => b.total - a.total) }))
    .sort((a, b) => b.total - a.total);

  let change = "";
  if (prev !== null && prev > 0) {
    const pct = ((total - prev) / prev) * 100;
    change = `<span class="delta ${pct > 0 ? "up" : "down"}">${pct > 0 ? "▲" : "▼"} %${Math.abs(pct).toLocaleString("tr-TR", { maximumFractionDigits: 0 })}</span> <span class="muted">önceki döneme göre (${fmt(prev)})</span>`;
  } else if (prev === 0 && !r.all) {
    change = `<span class="muted">Önceki dönemde kayıt yok</span>`;
  }

  const recent = S.expenses.slice().sort(byDateDesc).slice(0, 6);

  view.innerHTML = `
    <div class="grid summary">
      <div class="card hero">
        <div class="hero-label">Toplam harcama</div>
        <div class="hero-amount">${fmt(total)}</div>
        <div class="hero-sub">${change}</div>
        <div class="hero-stats">
          <div><small>İşlem</small><b>${list.length}</b></div>
          <div><small>Günlük ortalama</small><b>${fmt(total / days)}</b></div>
          <div><small>En büyük kalem</small><b>${byCat[0] ? esc(byCat[0].cat.name) : "–"}</b></div>
        </div>
      </div>

      <div class="card">
        <h3>Kim ne kadar harcadı</h3>
        ${total > 0 ? `
          <div class="split-bar">${byWho.filter((w) => w.total > 0).map((w, i) => `<span class="sb${i}" style="flex:${w.total}"></span>`).join("")}</div>
          <ul class="who-list">${byWho.map((w, i) => `
            <li>${avatar(w.name)}<span class="grow">${esc(w.name)}</span>
              <span class="muted">%${total ? Math.round((w.total / total) * 100) : 0}</span>
              <b>${fmt(w.total)}</b></li>`).join("")}</ul>` : emptyHint()}
      </div>

      <div class="card span2">
        <h3>Zaman içinde</h3>
        ${list.length ? trendChart(list, r) : emptyHint()}
      </div>

      <div class="card span2">
        <h3>Kategoriler</h3>
        ${byCat.length ? `<ul class="cat-list">${byCat.map((c) => `
          <li>
            <button class="cat-row" data-cat="${esc(c.cat.id)}">
              <span class="cat-icon" style="--c:${c.cat.color}">${c.cat.icon}</span>
              <span class="grow">
                <span class="cat-head"><b>${esc(c.cat.name)}</b><b>${fmt(c.total)}</b></span>
                <span class="bar"><span style="width:${(c.total / byCat[0].total) * 100}%;background:${c.cat.color}"></span></span>
                <span class="cat-subs muted">${c.subs.slice(0, 4).map((s) => `${esc(s.name)} ${fmtShort(s.total)}`).join(" · ")}</span>
              </span>
              <span class="pct">%${Math.round((c.total / total) * 100)}</span>
            </button>
          </li>`).join("")}</ul>` : emptyHint()}
      </div>

      <div class="card span2">
        <div class="card-head"><h3>Son harcamalar</h3><a href="#harcamalar" class="link">Tümünü gör</a></div>
        ${recent.length ? `<ul class="exp-list">${recent.map(expenseRow).join("")}</ul>` : emptyHint()}
      </div>
    </div>`;

  $$("[data-cat]", view).forEach((b) => b.onclick = () => {
    S.filter = { ...S.filter, cat: b.dataset.cat };
    location.hash = "harcamalar";
  });
  bindExpenseRows(view);
}

function emptyHint() {
  return `<div class="empty">Bu tarih aralığında harcama yok.<br><button class="btn soft small" onclick="document.querySelector('[data-act=add]').click()">Harcama ekle</button></div>`;
}

function trendChart(list, r) {
  const a = parseIso(r.from), b = parseIso(r.to);
  const spanDays = Math.round((b - a) / 864e5) + 1;
  let buckets;
  if (spanDays <= 45) {
    buckets = [];
    for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
      const key = iso(d);
      buckets.push({ key, label: String(d.getDate()), title: fmtDay(key), match: (e) => e.date === key });
    }
  } else {
    buckets = [];
    for (let d = new Date(a.getFullYear(), a.getMonth(), 1); d <= b; d.setMonth(d.getMonth() + 1)) {
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      buckets.push({ key, label: MONTHS_SHORT[d.getMonth()], title: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, match: (e) => e.date.startsWith(key) });
    }
  }
  const vals = buckets.map((bk) => ({ ...bk, total: sum(list.filter(bk.match)) }));
  const max = Math.max(...vals.map((v) => v.total), 1);
  const labelEvery = vals.length > 20 ? 5 : 1;
  return `
    <div class="chart" style="--n:${vals.length}">
      ${vals.map((v, i) => `
        <div class="col" title="${esc(v.title)}: ${fmt(v.total)}">
          <div class="bar-v"><span style="height:${(v.total / max) * 100}%"></span></div>
          <small>${i % labelEvery === 0 || i === vals.length - 1 ? v.label : ""}</small>
        </div>`).join("")}
    </div>
    <div class="chart-foot muted">En yüksek: ${fmt(max)} · ${spanDays <= 45 ? "günlük" : "aylık"} toplam</div>`;
}

// ---------- Harcamalar sayfası ----------
function renderExpenses(view) {
  const f = S.filter;
  view.innerHTML = `
    <div class="toolbar">
      <div class="search">${ICONS.search}<input id="q" type="search" placeholder="Not, kategori, tutar ara" value="${esc(f.q)}"></div>
      <select id="f-cat"><option value="">Tüm kategoriler</option>${S.categories.map((c) =>
        `<option value="${esc(c.id)}" ${f.cat === c.id ? "selected" : ""}>${c.icon} ${esc(c.name)}</option>`).join("")}</select>
      <select id="f-who"><option value="">Herkes</option>${members.map((m) =>
        `<option ${f.who === m.name ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select>
      <button class="btn soft" id="export" title="Excel için CSV indir">${ICONS.download}<span class="hide-sm">Dışa aktar</span></button>
    </div>
    <div id="exp-body"></div>`;
  $("#q").oninput = (e) => { S.filter.q = e.target.value; renderExpenseList(); };
  $("#f-cat").onchange = (e) => { S.filter.cat = e.target.value; renderExpenseList(); };
  $("#f-who").onchange = (e) => { S.filter.who = e.target.value; renderExpenseList(); };
  $("#export").onclick = () => exportCsv(filteredExpenses());
  renderExpenseList();
}

function filteredExpenses() {
  const r = currentRange();
  const f = S.filter;
  const q = f.q.trim().toLocaleLowerCase("tr");
  return S.expenses.filter((e) => inRange(e, r) &&
    (!f.cat || e.categoryId === f.cat) &&
    (!f.who || e.who === f.who) &&
    (!q || [e.note, e.sub, getCat(e.categoryId).name, e.who, String(e.amount).replace(".", ",")]
      .join(" ").toLocaleLowerCase("tr").includes(q))
  ).sort(byDateDesc);
}

function renderExpenseList() {
  const body = $("#exp-body");
  if (!body) return;
  const list = filteredExpenses();
  const total = sum(list);
  const days = groupBy(list, (e) => e.date);
  const activeCat = S.filter.cat ? getCat(S.filter.cat) : null;
  body.innerHTML = `
    <div class="list-summary">
      <span>${list.length} harcama${activeCat ? ` · ${activeCat.icon} ${esc(activeCat.name)} <button class="x" id="clear-cat" aria-label="Filtreyi kaldır">×</button>` : ""}</span>
      <b>${fmt(total)}</b>
    </div>
    ${list.length ? days.map(([day, items]) => `
      <div class="day">
        <div class="day-head"><span>${esc(fmtDayLong(day))}</span><span>${fmt(sum(items))}</span></div>
        <ul class="exp-list card flat">${items.map(expenseRow).join("")}</ul>
      </div>`).join("") : `<div class="empty card">Seçili filtrelerle eşleşen harcama yok.</div>`}`;
  const cc = $("#clear-cat");
  if (cc) cc.onclick = () => { S.filter.cat = ""; renderExpenses($("#view")); };
  bindExpenseRows(body);
}

function expenseRow(e) {
  const c = getCat(e.categoryId);
  return `
    <li>
      <button class="exp-row" data-id="${esc(e.id)}">
        <span class="cat-icon" style="--c:${c.color}">${c.icon}</span>
        <span class="grow">
          <b class="exp-title">${esc(e.note || e.sub || c.name)}</b>
          <small class="muted">${esc(c.name)}${e.sub && e.sub !== e.note ? " › " + esc(e.sub) : ""} · ${esc(fmtDay(e.date))}${e.receiptId ? " · 🧾" : ""}${e.pending ? " · ⏳" : ""}</small>
        </span>
        <span class="exp-right"><b>${fmt(e.amount)}</b>${avatarSmall(e.who)}</span>
      </button>
    </li>`;
}

function avatarSmall(name) {
  return `<span class="who-tag">${avatar(name)}<span>${esc(name)}</span></span>`;
}

function bindExpenseRows(root) {
  $$(".exp-row", root).forEach((b) => b.onclick = () => {
    const e = S.expenses.find((x) => x.id === b.dataset.id);
    if (e) openExpenseModal(e);
  });
}

function exportCsv(list) {
  const rows = [["Tarih", "Kategori", "Alt kategori", "Açıklama", "Kim", "Tutar"]];
  list.forEach((e) => rows.push([e.date, getCat(e.categoryId).name, e.sub || "", e.note || "", e.who || "", String(e.amount).replace(".", ",")]));
  const csv = "﻿" + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `ev-giderleri-${todayIso()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- Modal ----------
function openModal(html, { onClose, wide } = {}) {
  const root = $("#modal-root");
  root.innerHTML = `<div class="modal-backdrop"><div class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true">${html}</div></div>`;
  const close = () => { root.innerHTML = ""; document.removeEventListener("keydown", onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  $(".modal-backdrop", root).addEventListener("mousedown", (e) => { if (e.target.classList.contains("modal-backdrop")) close(); });
  $$("[data-close]", root).forEach((b) => b.onclick = close);
  return { root: $(".modal", root), close };
}

function catOptions(selectedCat, selectedSub) {
  return S.categories.map((c) => `<optgroup label="${c.icon} ${esc(c.name)}">${c.subs.map((s) =>
    `<option value="${esc(c.id)}|${esc(s)}" ${c.id === selectedCat && s === selectedSub ? "selected" : ""}>${esc(s)}</option>`).join("")}</optgroup>`).join("");
}

function openExpenseModal(exp) {
  const editing = !!exp;
  const e = exp || { amount: "", date: todayIso(), categoryId: "", sub: "", note: "", who: S.user.name };
  let cat = e.categoryId, sub = e.sub;
  const { root, close } = openModal(`
    <div class="modal-head">
      <h2>${editing ? "Harcamayı düzenle" : "Yeni harcama"}</h2>
      <button class="icon-btn" data-close aria-label="Kapat">×</button>
    </div>
    <form id="exp-form" class="modal-body stack">
      <label class="amount-field"><span>Tutar</span>
        <div class="amount-wrap"><input name="amount" inputmode="decimal" placeholder="0,00" value="${esc(amountInput(e.amount))}" required autocomplete="off"><span>₺</span></div>
      </label>
      <div class="field"><span class="label">Kategori</span><div class="cat-grid" id="cat-grid"></div></div>
      <div class="field" id="sub-field"><span class="label">Alt kategori</span><div class="chips wrap" id="sub-chips"></div></div>
      <div class="row2">
        <label>Tarih<input type="date" name="date" value="${esc(e.date)}" required></label>
        <div class="field"><span class="label">Kim harcadı</span>
          <div class="seg">${members.map((m) => `<label><input type="radio" name="who" value="${esc(m.name)}" ${e.who === m.name ? "checked" : ""}><span>${esc(m.name)}</span></label>`).join("")}</div>
        </div>
      </div>
      <label>Açıklama<input name="note" placeholder="Örn. Migros haftalık alışveriş" value="${esc(e.note)}" maxlength="120"></label>
      ${e.receiptId ? `<button type="button" class="btn soft" id="show-receipt">🧾 Fiş fotoğrafını göster</button><div id="receipt-img"></div>` : ""}
      <p class="error" id="form-error"></p>
      <div class="modal-actions">
        ${editing ? `<button type="button" class="btn danger-ghost" id="del">Sil</button>` : `<button type="button" class="btn soft" id="to-receipt">${ICONS.camera} Fiş tara</button>`}
        <span class="grow"></span>
        <button type="button" class="btn ghost" data-close>Vazgeç</button>
        <button type="submit" class="btn primary">${editing ? "Kaydet" : "Ekle"}</button>
      </div>
    </form>`);
  $$("[data-close]", root).forEach((b) => b.onclick = close);

  const drawCats = () => {
    $("#cat-grid", root).innerHTML = S.categories.map((c) => `
      <button type="button" class="cat-pick ${c.id === cat ? "on" : ""}" data-c="${esc(c.id)}" style="--c:${c.color}">
        <span>${c.icon}</span><small>${esc(c.name)}</small></button>`).join("");
    $$("[data-c]", root).forEach((b) => b.onclick = () => {
      cat = b.dataset.c;
      const c = getCat(cat);
      if (!c.subs.includes(sub)) sub = c.subs[0] || "";
      drawCats();
    });
    const c = getCat(cat);
    $("#sub-field", root).hidden = !cat;
    $("#sub-chips", root).innerHTML = c.subs.map((s) =>
      `<button type="button" class="chip ${s === sub ? "on" : ""}" data-s="${esc(s)}">${esc(s)}</button>`).join("");
    $$("[data-s]", root).forEach((b) => b.onclick = () => { sub = b.dataset.s; drawCats(); });
  };
  drawCats();
  if (!editing) setTimeout(() => $("[name=amount]", root).focus(), 50);

  $("#exp-form", root).onsubmit = async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const amount = parseAmount(f.get("amount"));
    const err = $("#form-error", root);
    if (!(amount > 0)) return (err.textContent = "Geçerli bir tutar girin.");
    if (!cat) return (err.textContent = "Bir kategori seçin.");
    const who = f.get("who") || S.user.name;
    const data = {
      amount, date: f.get("date"), categoryId: cat, sub, note: f.get("note").trim(), who,
      whoEmail: (members.find((m) => m.name === who) || {}).email || "",
    };
    try {
      if (editing) await S.store.updateExpense(exp.id, data);
      else await S.store.addExpenses([{ ...data, addedBy: S.user.name }]);
      close();
      toast(editing ? "Harcama güncellendi" : "Harcama eklendi", "ok");
    } catch (e2) {
      console.error(e2);
      err.textContent = "Kaydedilemedi. Bağlantıyı kontrol edin.";
    }
  };
  // Not: Firestore çevrimdışıyken de yazmayı kabul eder ve bağlantı gelince gönderir.
  const del = $("#del", root);
  if (del) del.onclick = async () => {
    if (!(await ask({ title: "Harcama silinsin mi?", text: `${fmt(exp.amount)} · ${exp.note || exp.sub}`, ok: "Sil", danger: true }))) return;
    await S.store.deleteExpense(exp.id);
    close();
    toast("Harcama silindi");
  };
  const tr = $("#to-receipt", root);
  if (tr) tr.onclick = () => { close(); openReceiptModal(); };
  const sr = $("#show-receipt", root);
  if (sr) sr.onclick = async () => {
    sr.disabled = true;
    const img = await S.store.getReceipt(exp.receiptId);
    $("#receipt-img", root).innerHTML = img ? `<img class="receipt-preview" src="${img}" alt="Fiş">` : `<p class="muted">Fiş bulunamadı.</p>`;
    sr.remove();
  };
}

// ---------- Fiş tarama ----------
function openReceiptModal() {
  const apiKey = S.settings.anthropicKey;
  const { root, close } = openModal(`
    <div class="modal-head"><h2>Fiş tara</h2><button class="icon-btn" data-close aria-label="Kapat">×</button></div>
    <div class="modal-body" id="rc-body"></div>`, { wide: true });
  const body = $("#rc-body", root);

  if (!apiKey) {
    body.innerHTML = `
      <div class="empty">
        <p>Fiş okuma için önce Ayarlar sayfasına yapay zeka anahtarını girin. Bir kez girmeniz yeterli, iki kişi de kullanabilir.</p>
        <a class="btn primary" href="#ayarlar" id="go-settings">Ayarlara git</a>
      </div>`;
    $("#go-settings", root).onclick = close;
    return;
  }

  body.innerHTML = `
    <label class="drop">
      <input type="file" accept="image/*" id="rc-file" hidden>
      <span class="drop-icon">${ICONS.camera}</span>
      <b>Fişin fotoğrafını çek ya da seç</b>
      <small class="muted">Fişin tamamı görünsün, ışık yeterli olsun.</small>
    </label>`;
  $("#rc-file", root).onchange = async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    body.innerHTML = `<div class="center-msg"><div class="spinner"></div><p>Fiş okunuyor, kalemler kategorilere ayrılıyor…</p></div>`;
    try {
      const [forAi, forStore] = await Promise.all([resizeImage(file, 1600, 0.85), resizeImage(file, 1000, 0.6)]);
      const data = await readReceipt({ apiKey, imageDataUrl: forAi, categories: S.categories });
      if (!data.items.length) throw new Error("Fişte kalem bulunamadı.");
      showReceiptPreview(root, close, data, forStore);
    } catch (err) {
      console.error(err);
      const msg = err?.status === 401 ? "Yapay zeka anahtarı geçersiz görünüyor. Ayarlardan kontrol edin."
        : err?.message?.includes("Fiş") ? err.message : "Fiş okunamadı. Daha net bir fotoğrafla tekrar deneyin.";
      body.innerHTML = `<div class="empty"><p class="error">${esc(msg)}</p><button class="btn primary" id="retry">Tekrar dene</button></div>`;
      $("#retry", root).onclick = () => { close(); openReceiptModal(); };
    }
  };
}

function showReceiptPreview(root, close, data, imageForStore) {
  const body = $("#rc-body", root);
  const items = data.items.map((it) => ({ ...it }));
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(data.date) && data.date <= todayIso() ? data.date : todayIso();
  let group = true;

  const draw = () => {
    const itemsTotal = items.reduce((a, b) => a + (b.amount || 0), 0);
    const diff = Math.round((data.total - itemsTotal) * 100) / 100;
    const groups = groupBy(items, (it) => it.categoryId + "|" + it.sub);
    body.innerHTML = `
      <div class="rc-top">
        <label>Mağaza<input id="rc-store" value="${esc(data.store)}"></label>
        <label>Tarih<input type="date" id="rc-date" value="${esc($("#rc-date", root)?.value || validDate)}"></label>
        <div class="field"><span class="label">Kim</span>
          <div class="seg">${members.map((m) => `<label><input type="radio" name="rc-who" value="${esc(m.name)}" ${(($("input[name=rc-who]:checked", root)?.value) || S.user.name) === m.name ? "checked" : ""}><span>${esc(m.name)}</span></label>`).join("")}</div>
        </div>
      </div>
      <ul class="rc-items">${items.map((it, i) => `
        <li>
          <span class="cat-icon sm" style="--c:${getCat(it.categoryId).color}">${getCat(it.categoryId).icon}</span>
          <input class="rc-name" data-i="${i}" value="${esc(it.name)}">
          <select class="rc-cat" data-i="${i}">${catOptions(it.categoryId, it.sub)}</select>
          <input class="rc-amt" data-i="${i}" inputmode="decimal" value="${esc(amountInput(it.amount))}">
          <button class="icon-btn rc-del" data-i="${i}" aria-label="Kalemi çıkar">×</button>
        </li>`).join("")}</ul>
      <div class="rc-sum">
        <span>Kalemler toplamı <b>${fmt(itemsTotal)}</b></span>
        <span>Fiş toplamı <b>${fmt(data.total)}</b></span>
        ${Math.abs(diff) >= 0.01 ? `<span class="warn-text">Fark ${fmt(diff)}. Tutarları kontrol edin.</span>` : `<span class="ok-text">✓ Tutarlar uyuşuyor</span>`}
      </div>
      <label class="check"><input type="checkbox" id="rc-group" ${group ? "checked" : ""}> Aynı alt kategorideki kalemleri tek harcama olarak kaydet</label>
      <div class="rc-result muted">${group
        ? `${groups.length} harcama kaydedilecek: ${groups.map(([k, its]) => `${getCat(its[0].categoryId).icon} ${esc(its[0].sub)} ${fmt(sum(its))}`).join(" · ")}`
        : `${items.length} harcama kaydedilecek.`}</div>
      <p class="error" id="rc-error"></p>
      <div class="modal-actions">
        <button class="btn ghost" data-close>Vazgeç</button>
        <span class="grow"></span>
        <button class="btn primary" id="rc-save">Kaydet</button>
      </div>`;
    $$("[data-close]", body).forEach((b) => b.onclick = close);
    $("#rc-store", body).oninput = (e) => (data.store = e.target.value);
    $$(".rc-name", body).forEach((el) => el.oninput = () => (items[el.dataset.i].name = el.value));
    $$(".rc-amt", body).forEach((el) => el.onchange = () => { items[el.dataset.i].amount = parseAmount(el.value) || 0; draw(); });
    $$(".rc-cat", body).forEach((el) => el.onchange = () => {
      const [c, s] = el.value.split("|");
      Object.assign(items[el.dataset.i], { categoryId: c, sub: s });
      draw();
    });
    $$(".rc-del", body).forEach((el) => el.onclick = () => { items.splice(Number(el.dataset.i), 1); draw(); });
    $("#rc-group", body).onchange = (e) => { group = e.target.checked; draw(); };
    $("#rc-save", body).onclick = save;
  };

  const save = async () => {
    const btn = $("#rc-save", body);
    const store = $("#rc-store", body).value.trim();
    const date = $("#rc-date", body).value || todayIso();
    const who = $("input[name=rc-who]:checked", body)?.value || S.user.name;
    const whoEmail = (members.find((m) => m.name === who) || {}).email || "";
    const valid = items.filter((it) => it.amount > 0);
    if (!valid.length) return ($("#rc-error", body).textContent = "Kaydedilecek kalem yok.");
    btn.disabled = true;
    btn.textContent = "Kaydediliyor…";
    try {
      const receiptId = await S.store.saveReceipt(imageForStore);
      const prefix = store ? store + ": " : "";
      const list = group
        ? groupBy(valid, (it) => it.categoryId + "|" + it.sub).map(([, its]) => ({
            amount: Math.round(sum(its) * 100) / 100, categoryId: its[0].categoryId, sub: its[0].sub,
            note: (prefix + its.map((x) => x.name).join(", ")).slice(0, 120),
          }))
        : valid.map((it) => ({ amount: it.amount, categoryId: it.categoryId, sub: it.sub, note: (prefix + it.name).slice(0, 120) }));
      await S.store.addExpenses(list.map((x) => ({ ...x, date, who, whoEmail, receiptId, addedBy: S.user.name })));
      close();
      toast(`${list.length} harcama fişten eklendi`, "ok");
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      btn.textContent = "Kaydet";
      $("#rc-error", body).textContent = "Kaydedilemedi. Bağlantıyı kontrol edin.";
    }
  };
  draw();
}

// ---------- Ayarlar ----------
function renderSettings(view) {
  const usage = (id) => S.expenses.filter((e) => e.categoryId === id).length;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  view.innerHTML = `
    <div class="grid settings">
      <div class="card">
        <h3>Hesap</h3>
        <div class="account">${avatar(S.user.name)}<div class="grow"><b>${esc(S.user.name)}</b><small class="muted">${esc(S.user.email)}</small></div>
          <button class="btn soft" id="logout">Çıkış yap</button></div>
        ${S.store.mode === "demo" ? `<p class="note">Bu kopya deneme modunda. Veriler yalnızca bu cihazda duruyor; buluta bağlanınca tüm cihazlarda ortak olacak.</p>` : `<p class="muted small">Veriler buluta kaydediliyor ve tüm cihazlarda anında güncelleniyor. İnternet yokken girilen harcamalar bağlantı gelince gönderilir.</p>`}
      </div>

      <div class="card">
        <h3>Uygulamayı yükle</h3>
        ${standalone ? `<p class="ok-text">✓ Uygulama bu cihazda yüklü.</p>` : isIos
          ? `<p class="small">iPhone'da Safari ile açın, alttaki <b>Paylaş</b> düğmesine dokunun ve <b>Ana Ekrana Ekle</b>'yi seçin.</p>`
          : `<p class="small">Bilgisayarda Chrome veya Edge adres çubuğundaki yükle simgesine, Android'de menüdeki <b>Uygulamayı yükle</b>'ye dokunun.</p>
             <button class="btn primary" id="install" ${installPrompt ? "" : "hidden"}>Şimdi yükle</button>`}
      </div>

      <div class="card">
        <h3>Fiş okuma</h3>
        <p class="small muted">Fiş fotoğraflarını okumak için Anthropic (Claude) API anahtarı gerekir. Anahtar bulutta saklanır, ikiniz de kullanabilirsiniz.</p>
        <form id="key-form" class="inline-form">
          <input type="password" name="key" placeholder="${S.settings.anthropicKey ? "Anahtar kayıtlı (değiştirmek için yenisini yazın)" : "sk-ant-..."}" autocomplete="off">
          <button class="btn primary" type="submit">Kaydet</button>
        </form>
        ${S.settings.anthropicKey ? `<p class="ok-text small">✓ Anahtar kayıtlı, fiş okuma hazır.</p>` : ""}
      </div>

      <div class="card">
        <h3>Veriler</h3>
        <p class="small muted">Toplam ${S.expenses.length} harcama kayıtlı.</p>
        <div class="row-btns">
          <button class="btn soft" id="csv-all">${ICONS.download} Tümünü CSV olarak indir</button>
          ${S.store.mode === "demo" ? `<button class="btn danger-ghost" id="clear-demo">Örnek verileri sil</button>` : ""}
        </div>
      </div>

      <div class="card span2">
        <div class="card-head"><h3>Kategoriler</h3><button class="btn soft small" id="add-cat">${ICONS.plus} Kategori ekle</button></div>
        <ul class="cat-admin">${S.categories.map((c) => `
          <li>
            <div class="cat-admin-head">
              <span class="cat-icon" style="--c:${c.color}">${c.icon}</span>
              <b class="grow">${esc(c.name)}</b>
              <small class="muted">${usage(c.id)} kayıt</small>
              <button class="icon-btn" data-delcat="${esc(c.id)}" aria-label="Kategoriyi sil">${ICONS.trash}</button>
            </div>
            <div class="chips wrap">${c.subs.map((s) => `<span class="chip static">${esc(s)}<button data-delsub="${esc(c.id)}|${esc(s)}" aria-label="Sil">×</button></span>`).join("")}
              <button class="chip add" data-addsub="${esc(c.id)}">+ Alt kategori</button></div>
          </li>`).join("")}</ul>
      </div>
    </div>`;

  $("#logout").onclick = () => S.store.signOut();
  const inst = $("#install");
  if (inst) inst.onclick = async () => { installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; inst.hidden = true; };
  $("#key-form").onsubmit = async (e) => {
    e.preventDefault();
    const key = new FormData(e.target).get("key").trim();
    if (!key) return;
    await S.store.saveSettings({ anthropicKey: key });
    S.settings.anthropicKey = key;
    toast("Anahtar kaydedildi", "ok");
    renderView();
  };
  $("#csv-all").onclick = () => exportCsv(S.expenses.slice().sort(byDateDesc));
  const cd = $("#clear-demo");
  if (cd) cd.onclick = async () => { if (await ask({ title: "Örnek harcamalar silinsin mi?", ok: "Sil", danger: true })) { await S.store.clearAll(); toast("Örnek veriler silindi"); } };

  const saveCats = async (list) => { S.categories = list; await S.store.saveCategories(list); renderView(); };
  $("#add-cat").onclick = async () => {
    const name = await ask({ title: "Yeni kategori", input: { placeholder: "Örn. Çocuk" }, ok: "Devam" });
    if (!name) return;
    const icon = ((await ask({ title: "Kategori simgesi", text: "Bir emoji yazın ya da olduğu gibi bırakın.", input: { value: "📌" }, ok: "Ekle" })) || "📌").slice(0, 4);
    const id = name.toLocaleLowerCase("tr").replace(/[^a-z0-9çğıöşü]+/g, "-") + "-" + Date.now().toString(36).slice(-4);
    saveCats([...S.categories, { id, name: name, icon, color: PALETTE[S.categories.length % PALETTE.length], subs: ["Genel"] }]);
  };
  $$("[data-addsub]").forEach((b) => b.onclick = async () => {
    const name = await ask({ title: `${getCat(b.dataset.addsub).name} için alt kategori`, input: { placeholder: "Alt kategori adı" }, ok: "Ekle" });
    if (!name) return;
    saveCats(S.categories.map((c) => c.id === b.dataset.addsub && !c.subs.includes(name) ? { ...c, subs: [...c.subs, name] } : c));
  });
  $$("[data-delsub]").forEach((b) => b.onclick = async () => {
    const [id, s] = b.dataset.delsub.split("|");
    const c = getCat(id);
    if (c.subs.length <= 1) return toast("Her kategoride en az bir alt kategori kalmalı");
    if (!(await ask({ title: `"${s}" silinsin mi?`, text: "Bu alt kategoriye kayıtlı harcamalar silinmez.", ok: "Sil", danger: true }))) return;
    saveCats(S.categories.map((x) => x.id === id ? { ...x, subs: x.subs.filter((y) => y !== s) } : x));
  });
  $$("[data-delcat]").forEach((b) => b.onclick = async () => {
    const c = getCat(b.dataset.delcat);
    const n = usage(c.id);
    if (n) return toast(`Bu kategoride ${n} harcama var; önce onları başka kategoriye taşıyın`);
    if (!(await ask({ title: `"${c.name}" kategorisi silinsin mi?`, ok: "Sil", danger: true }))) return;
    saveCats(S.categories.filter((x) => x.id !== c.id));
  });
}

// ---------- Genel yardımcılar ----------
function sum(list) { return list.reduce((a, e) => a + (Number(e.amount) || 0), 0); }
function groupBy(list, keyFn) {
  const m = new Map();
  list.forEach((x) => { const k = keyFn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); });
  return [...m.entries()];
}
function byDateDesc(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : a.createdAt || Date.now();
  const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : b.createdAt || Date.now();
  return tb - ta;
}

const svg = (d) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  home: svg('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>'),
  list: svg('<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  camera: svg('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
  download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>'),
  trash: svg('<path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>'),
};

start();
