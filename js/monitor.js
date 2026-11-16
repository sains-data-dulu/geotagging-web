"use strict";
/* Halaman monitoring: hanya menampilkan grid, sampel, dan hasil tagging (tanpa fitur tagging). */
const CFG = window.CONFIG || {};
const LS_SET = "geotag_settings_v1", LS_MON = "geotag_monitor_v1", LS_DATA = "geotag_records_v1";
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function toast(msg, ms = 2400) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), ms); }
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
function fmtWaktu(v) {
  if (!v) return ""; const d = new Date(v); if (isNaN(d)) return String(v);
  const p = n => String(n).padStart(2, "0");
  return `${d.getDate()} ${BULAN[d.getMonth()]} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function relatif(d) {
  const s = Math.round((Date.now() - d) / 1000);
  return s < 10 ? "baru saja" : s < 60 ? `${s} detik lalu` : s < 3600 ? `${Math.floor(s / 60)} menit lalu` : fmtWaktu(d);
}

/* ---------- pengaturan ---------- */
const mon = (() => {
  const d = { url: "", auto: 60, basemap: "Satelit", showPoints: true, showSamples: true, showGrid: true };
  try { Object.assign(d, JSON.parse(localStorage.getItem(LS_MON)) || {}); } catch (e) {}
  if (!d.url) { try { d.url = (JSON.parse(localStorage.getItem(LS_SET)) || {}).url || ""; } catch (e) {} }
  if (!d.url) d.url = CFG.APPS_SCRIPT_URL || "";
  const q = new URLSearchParams(location.search).get("url"); if (q) d.url = q;
  return d;
})();
const saveMon = () => localStorage.setItem(LS_MON, JSON.stringify(mon));

/* ---------- grid & sampel ---------- */
const GRID_FEATS = window.GRID.features, gridById = {};
GRID_FEATS.forEach(f => {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  f.geometry.coordinates[0].forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); });
  f.bbox = [x0, y0, x1, y1]; gridById[f.properties.id_sub] = f;
});
const SAMPLES = (() => {
  const m = {};
  GRID_FEATS.forEach(f => {
    const p = f.properties, n = p.id_polygon_asal;
    const o = m[n] || (m[n] = { no: n, subs: [], bbox: [1e9, 1e9, -1e9, -1e9], desa: null, kec: null });
    o.subs.push(p.id_sub);
    o.bbox = [Math.min(o.bbox[0], f.bbox[0]), Math.min(o.bbox[1], f.bbox[1]), Math.max(o.bbox[2], f.bbox[2]), Math.max(o.bbox[3], f.bbox[3])];
    if (p.sub_baris === 2 && p.sub_kolom === 2) { o.desa = p.nmdesa_right; o.kec = p.nmkec_right; }
  });
  return Object.values(m).sort((a, b) => a.no - b.no);
})();
const sampleBounds = s => L.latLngBounds([s.bbox[1], s.bbox[0]], [s.bbox[3], s.bbox[2]]);

/* ---------- data ---------- */
let records = [], source = "", lastLoad = null, loading = false, filterPetugas = "";
const view = () => filterPetugas ? records.filter(r => r.petugas === filterPetugas) : records;
const taggedSet = () => new Set(view().map(r => r.id_sub));
function normalize(r) {
  const num = v => v === "" || v == null ? null : Number(v);
  const g = gridById[r.id_sub];
  return {
    ...r, latitude: num(r.latitude), longitude: num(r.longitude), akurasi_m: num(r.akurasi_m), jarak_ke_grid_m: num(r.jarak_ke_grid_m),
    id_polygon_asal: num(r.id_polygon_asal) ?? (g ? g.properties.id_polygon_asal : null),
    foto_url: Array.isArray(r.foto_url) ? r.foto_url : String(r.foto_url || "").split(/\s*\n\s*/).filter(Boolean),
    jumlah_foto: num(r.jumlah_foto) ?? (r.foto ? r.foto.length : 0)
  };
}
async function load(silent) {
  if (loading) return; loading = true; $("#btnRefresh").classList.add("busy");
  try {
    if (mon.url) {
      const res = await fetch(mon.url + (mon.url.includes("?") ? "&" : "?") + "action=data&t=" + Date.now());
      const j = await res.json(); if (!j.ok) throw new Error(j.error || "respon tidak valid");
      records = (j.records || []).filter(r => r.uuid && gridById[r.id_sub]).map(normalize); source = "Google Sheets";
    } else {
      let local = []; try { local = JSON.parse(localStorage.getItem(LS_DATA)) || []; } catch (e) {}
      records = local.map(r => normalize({ ...r, foto_url: [], jumlah_foto: (r.foto || []).length })); source = "perangkat ini";
    }
    lastLoad = new Date(); render();
  } catch (e) {
    $("#monUpdated").textContent = "Gagal memuat data"; if (!silent) toast("Gagal memuat: " + (e.message || e), 3500);
  } finally { loading = false; $("#btnRefresh").classList.remove("busy"); }
}

/* ---------- peta ---------- */
const map = L.map("map", { zoomControl: false });
const baseLayers = {
  Satelit: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 21, maxNativeZoom: 19, attribution: "Esri" }),
  Peta: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 21, maxNativeZoom: 19, attribution: "© OpenStreetMap" })
};
let currentBase = null;
function setBase(n) { if (!baseLayers[n]) n = "Satelit"; if (currentBase) map.removeLayer(currentBase); currentBase = baseLayers[n].addTo(map); mon.basemap = n; }
setBase(mon.basemap);

const gridStyle = f => taggedSet().has(f.properties.id_sub)
  ? { color: "#34d399", weight: 2, fillColor: "#10b981", fillOpacity: .42 }
  : { color: "#ffffff", weight: 2.2, fillColor: "#ffffff", fillOpacity: .12, dashArray: "6 4" };
const gridLayer = L.geoJSON(window.GRID, {
  style: gridStyle,
  onEachFeature: (f, layer) => {
    layer.bindTooltip(f.properties.id_sub, { permanent: true, direction: "center", className: "grid-label" });
    layer.on("click", () => {
      const p = f.properties, rs = view().filter(r => r.id_sub === p.id_sub);
      L.popup({ closeButton: false }).setLatLng(layer.getBounds().getCenter()).setContent(
        `<div class="pop-title">Grid ${esc(p.id_sub)}</div>
         <div class="pop-sub">Sampel ${p.id_polygon_asal} · ${esc(p.sub_posisi.replace("_", " "))}</div>
         <div class="pop-kv">${rs.length ? rs.map(r => `<b class="t-ok">✓</b> ${esc(r.petugas || "-")} · ${fmtWaktu(r.waktu)}<br><span>${esc(r.jenis_tanaman)} · ${esc(r.jenis_lahan)}</span>`).join("<br>") : "<span>Belum di-tag</span>"}</div>`).openOn(map);
    });
  }
}).addTo(map);
function updateLabels() {
  const z = map.getZoom(); map.getContainer().classList.toggle("compact", z < 16);
  gridLayer.eachLayer(l => { const t = l.getTooltip(); if (t) t.setOpacity(z >= 17 ? 1 : 0); });
}
map.on("zoomend", updateLabels);

const samplesLayer = L.layerGroup(), pointsLayer = L.layerGroup();
// sisakan ruang untuk panel saat zoom ke suatu area
function fitTo(b, maxZoom) {
  const o = window.innerWidth >= 900 ? { paddingTopLeft: [$("#monPanel").classList.contains("hidden-desk") ? 40 : 420, 40], paddingBottomRight: [80, 40] }
    : { paddingTopLeft: [30, 30], paddingBottomRight: [70, (sheetH || 260) + 30] };
  map.fitBounds(b, Object.assign(o, maxZoom ? { maxZoom } : {}));
}
function drawSamples() {
  samplesLayer.clearLayers(); const tg = taggedSet();
  SAMPLES.forEach(sm => {
    const b = sampleBounds(sm), done = sm.subs.filter(id => tg.has(id)).length, full = done === sm.subs.length;
    L.rectangle(b, { color: full ? "#10b981" : "#f59e0b", weight: 3.5, fill: false, interactive: false }).addTo(samplesLayer);
    L.marker([sm.bbox[3], (sm.bbox[0] + sm.bbox[2]) / 2], {
      icon: L.divIcon({ className: "sample-label-wrap", iconSize: [0, 0], html: `<div class="sample-label ${full ? "done" : ""}"><span class="full">Sampel </span>${sm.no}<i>${done}/${sm.subs.length}</i></div>` }),
      zIndexOffset: 500
    }).on("click", () => fitTo(b, 18)).addTo(samplesLayer);
  });
}
function pointPopup(r) {
  const el = document.createElement("div");
  el.innerHTML = `<div class="pop-title">Grid ${esc(r.id_sub)}</div>
    <div class="pop-sub">${esc(r.petugas || "-")} · ${fmtWaktu(r.waktu)} · ±${Math.round(r.akurasi_m)} m</div>
    <div class="pop-kv"><span>Tanaman</span> ${esc(r.jenis_tanaman)}<br><span>Lahan</span> ${esc(r.jenis_lahan)}<br>
      <span>Fase</span> ${esc(r.fase_tumbuh)}<br><span>Topografi</span> ${esc(r.topografi)} · <span>Pola</span> ${esc(r.pola_tanam)}
      ${r.catatan ? `<br><span>Catatan</span> ${esc(r.catatan)}` : ""}
      ${r.di_dalam_grid === "Ya" ? "" : `<br><b class="t-warn">Di luar grid (${r.jarak_ke_grid_m} m)</b>`}</div>
    ${r.foto_url.length ? `<div class="pop-photos">${r.foto_url.map((u, i) => `<a class="btn btn-soft btn-sm" href="${esc(u)}" target="_blank" rel="noopener"><svg><use href="#i-camera"/></svg>Foto ${i + 1}</a>`).join("")}</div>`
      : r.jumlah_foto ? `<div class="pop-sub">${r.jumlah_foto} foto (belum terkirim ke Drive)</div>` : ""}`;
  return el;
}
function drawPoints() {
  pointsLayer.clearLayers();
  view().forEach(r => {
    if (r.latitude == null || r.longitude == null) return;
    L.circleMarker([r.latitude, r.longitude], { radius: 8, color: "#fff", weight: 3, fillColor: r.di_dalam_grid === "Ya" ? "#7c3aed" : "#ea580c", fillOpacity: 1 })
      .bindPopup(() => pointPopup(r), { closeButton: false, minWidth: 220, maxWidth: 260 }).addTo(pointsLayer);
  });
}
function applyLayerVis() {
  const set = (l, on) => on ? (map.hasLayer(l) || l.addTo(map)) : map.removeLayer(l);
  set(gridLayer, mon.showGrid); set(samplesLayer, mon.showSamples); set(pointsLayer, mon.showPoints);
}

/* ---------- panel ---------- */
function render() {
  const v = view(), tg = taggedSet();
  const selesai = SAMPLES.filter(sm => sm.subs.every(id => tg.has(id))).length;
  const pet = [...new Set(records.map(r => r.petugas).filter(Boolean))].sort();
  $("#mPts").textContent = v.length;
  $("#mGrid").textContent = `${tg.size}/${GRID_FEATS.length}`;
  $("#mSmp").textContent = `${selesai}/${SAMPLES.length}`;
  $("#mPet").textContent = filterPetugas ? 1 : pet.length;
  const pct = Math.round(tg.size / GRID_FEATS.length * 100); $("#mBar").style.width = pct + "%"; $("#mPct").textContent = pct + "%";
  $("#fPetugas").innerHTML = `<option value="">Semua petugas (${pet.length})</option>` + pet.map(p => `<option value="${esc(p)}">${esc(p)} · ${records.filter(r => r.petugas === p).length} titik</option>`).join("");
  $("#fPetugas").value = filterPetugas;
  $("#monNote").innerHTML = mon.url ? "" : `Belum terhubung ke Google Sheets, jadi yang tampil hanya data di perangkat ini. <a href="#" id="lnkSet">Atur sumber data</a>`;
  const lnk = $("#lnkSet"); if (lnk) lnk.onclick = e => { e.preventDefault(); openSet(); };

  $("#sampleList").innerHTML = SAMPLES.map(sm => {
    const order = [...sm.subs].sort((a, b) => { const pa = gridById[a].properties, pb = gridById[b].properties; return pa.sub_baris - pb.sub_baris || pa.sub_kolom - pb.sub_kolom; });
    const done = sm.subs.filter(id => tg.has(id)).length, n = v.filter(r => r.id_polygon_asal === sm.no).length;
    const last = v.filter(r => r.id_polygon_asal === sm.no).map(r => new Date(r.waktu)).filter(d => !isNaN(d)).sort((a, b) => b - a)[0];
    return `<button class="sample ${done === sm.subs.length ? "done" : ""}" data-sample="${sm.no}">
      <div class="mini">${order.map(id => `<i class="${tg.has(id) ? "on" : ""}"></i>`).join("")}</div>
      <div class="s-main">
        <div class="s-title">Sampel ${sm.no}${done === sm.subs.length ? `<span class="tag ok">selesai</span>` : ""}</div>
        <div class="s-sub">${done}/${sm.subs.length} sub-grid · ${n} titik${last ? " · terakhir " + fmtWaktu(last) : ""}${sm.desa ? `<br>${esc(sm.desa)}, ${esc(sm.kec || "")}` : ""}</div>
        <div class="bar"><i style="width:${done / sm.subs.length * 100}%"></i></div>
      </div>
      <svg class="s-go"><use href="#i-nav"/></svg>
    </button>`;
  }).join("");
  $("#sampleList").querySelectorAll("[data-sample]").forEach(b => b.onclick = () => {
    const sm = SAMPLES.find(x => x.no === +b.dataset.sample); collapseOnMobile();
    fitTo(sampleBounds(sm), 18);
  });

  const recent = [...v].sort((a, b) => new Date(b.waktu) - new Date(a.waktu)).slice(0, 15);
  $("#recent").innerHTML = recent.length ? recent.map(r => `
    <button class="recent-item" data-uuid="${esc(r.uuid)}">
      <span class="ri-dot ${r.di_dalam_grid === "Ya" ? "" : "out"}"></span>
      <span class="ri-main"><b>Grid ${esc(r.id_sub)}</b> · ${esc(r.jenis_tanaman)}<br><small>${esc(r.petugas || "-")} · ${fmtWaktu(r.waktu)}${r.jumlah_foto ? ` · ${r.jumlah_foto} foto` : ""}</small></span>
    </button>`).join("") : `<p class="hint">Belum ada data tagging.</p>`;
  $("#recent").querySelectorAll("[data-uuid]").forEach(b => b.onclick = () => {
    const r = v.find(x => x.uuid === b.dataset.uuid); collapseOnMobile();
    if (!mon.showPoints) { mon.showPoints = true; saveMon(); applyLayerVis(); }
    map.setView([r.latitude, r.longitude], 19);
    L.popup({ closeButton: false, minWidth: 220, maxWidth: 260 }).setLatLng([r.latitude, r.longitude]).setContent(pointPopup(r)).openOn(map);
  });

  gridLayer.setStyle(gridStyle); drawSamples(); drawPoints(); applyLayerVis(); updateUpdated();
}
function updateUpdated() { if (lastLoad) $("#monUpdated").textContent = `Sumber: ${source} · ${relatif(lastLoad)}`; }
setInterval(updateUpdated, 15000);
$("#fPetugas").onchange = e => { filterPetugas = e.target.value; render(); };

/* ---------- panel: bottom sheet yang bisa digeser (HP) / panel samping (laptop) ---------- */
const sheet = $("#monPanel"), root = document.documentElement;
const isMobile = () => window.innerWidth < 900;
let sheetState = "peek", sheetH = 0;
function snaps() {
  const head = sheet.querySelector(".mon-head"), body = sheet.querySelector(".mon-body");
  return { mini: head.offsetTop + head.offsetHeight + 12, peek: body.offsetTop + 6, full: Math.round(window.innerHeight * 0.88) };
}
function setSheetH(h) { sheetH = h; sheet.style.height = h + "px"; root.style.setProperty("--sheet-h", h + "px"); }
function setSheet(state) {
  if (!isMobile()) { sheet.style.height = ""; root.style.setProperty("--sheet-h", "0px"); sheetH = 0; return; }
  sheetState = state; setSheetH(snaps()[state]);
}
function collapseOnMobile() { if (isMobile()) setSheet("mini"); }
(() => {
  let startY = 0, startH = 0, lastY = 0, lastT = 0, vel = 0, moved = false, active = false;
  const zone = e => e.target.closest(".mon-handle") || (e.target.closest(".mon-head, .mon-stats, .mon-progress") && !e.target.closest("button, select, a, input"));
  sheet.addEventListener("pointerdown", e => {
    if (!isMobile() || !zone(e)) return;
    active = true; moved = false; startY = lastY = e.clientY; lastT = e.timeStamp; startH = sheet.offsetHeight; vel = 0;
    sheet.classList.add("dragging"); sheet.setPointerCapture(e.pointerId);
  });
  sheet.addEventListener("pointermove", e => {
    if (!active) return;
    const dy = e.clientY - startY; if (Math.abs(dy) > 6) moved = true;
    const sp = snaps(); setSheetH(Math.max(sp.mini, Math.min(sp.full, startH - dy)));
    if (e.timeStamp > lastT) vel = (e.clientY - lastY) / (e.timeStamp - lastT); lastY = e.clientY; lastT = e.timeStamp;
  });
  const end = e => {
    if (!active) return; active = false; sheet.classList.remove("dragging");
    const order = ["mini", "peek", "full"], sp = snaps();
    if (!moved) { // ketuk: buka/tutup bertahap
      setSheet(sheetState === "full" ? "peek" : sheetState === "peek" ? "full" : "peek"); return;
    }
    let target;
    if (vel < -0.4) target = order.find(k => sp[k] > sheetH + 4) || "full";          // dilempar ke atas
    else if (vel > 0.4) target = [...order].reverse().find(k => sp[k] < sheetH - 4) || "mini"; // dilempar ke bawah
    else target = order.reduce((b, k) => Math.abs(sp[k] - sheetH) < Math.abs(sp[b] - sheetH) ? k : b, "mini"); // terdekat
    setSheet(target);
  };
  sheet.addEventListener("pointerup", end); sheet.addEventListener("pointercancel", end);
})();
window.addEventListener("resize", () => setSheet(sheetState));
/* laptop: panel bisa disembunyikan */
$("#btnPanel").onclick = () => { sheet.classList.toggle("hidden-desk"); $("#btnPanel").classList.toggle("on", !sheet.classList.contains("hidden-desk")); };

/* tombol peta */
$("#btnRefresh").onclick = () => load(false).then(() => lastLoad && toast("Data diperbarui"));
$("#btnFit").onclick = () => fitTo(gridLayer.getBounds());
function syncLayerPanel() {
  document.querySelectorAll("#segBase button").forEach(b => b.classList.toggle("on", b.dataset.base === mon.basemap));
  $("#tgPoints").checked = mon.showPoints; $("#tgSamples").checked = mon.showSamples; $("#tgGrid").checked = mon.showGrid;
}
$("#btnLayer").onclick = e => { e.stopPropagation(); syncLayerPanel(); $("#layerPanel").classList.toggle("open"); $("#btnLayer").classList.toggle("on", $("#layerPanel").classList.contains("open")); };
map.on("click movestart", () => { $("#layerPanel").classList.remove("open"); $("#btnLayer").classList.remove("on"); });
document.querySelectorAll("#segBase button").forEach(b => b.onclick = () => { setBase(b.dataset.base); saveMon(); syncLayerPanel(); });
[["tgPoints", "showPoints"], ["tgSamples", "showSamples"], ["tgGrid", "showGrid"]].forEach(([id, k]) =>
  $("#" + id).addEventListener("change", e => { mon[k] = e.target.checked; saveMon(); applyLayerVis(); }));

/* pengaturan sumber data */
function openSet() { $("#mUrl").value = mon.url; $("#mAuto").value = String(mon.auto); const p = $("#pageMonSet"); p.classList.add("open"); p.setAttribute("aria-hidden", "false"); }
function closeSet() { const p = $("#pageMonSet"); p.classList.remove("open"); p.setAttribute("aria-hidden", "true"); }
$("#btnMonSet").onclick = openSet;
document.querySelectorAll("[data-close]").forEach(b => b.onclick = closeSet);
$("#btnMonSave").onclick = () => { mon.url = $("#mUrl").value.trim(); mon.auto = +$("#mAuto").value; saveMon(); closeSet(); startAuto(); load(false); };
$("#viewerClose").onclick = () => $("#viewer").classList.remove("open");

/* muat ulang otomatis */
let autoTimer = null;
function startAuto() { clearInterval(autoTimer); if (mon.url && mon.auto > 0) autoTimer = setInterval(() => { if (!document.hidden) load(true); }, mon.auto * 1000); }
document.addEventListener("visibilitychange", () => { if (!document.hidden && lastLoad && Date.now() - lastLoad > 30000) load(true); });

// cek apakah css/style.css versi terbaru sudah ter-upload
if (getComputedStyle(sheet).position !== "fixed") {
  document.body.insertAdjacentHTML("afterbegin", `<div style="position:fixed;z-index:9999;top:0;left:0;right:0;background:#b91c1c;color:#fff;padding:12px 16px;font:600 14px system-ui">File <code>css/style.css</code> di GitHub belum versi terbaru. Upload ulang semua file dari zip, lalu muat ulang halaman ini.</div>`);
}
render(); setSheet("peek"); $("#btnPanel").classList.add("on"); fitTo(gridLayer.getBounds()); updateLabels(); load(true); startAuto();
