"use strict";
const APP_VERSION = "2.3.0";
const OPSI = {
  jenis_lahan: ["Sawah Rawa", "Sawah Pasang Surut", "Sawah Irigasi", "Sawah Tadah Hujan", "Bukan Sawah"],
  fase_tumbuh: ["Persiapan Lahan", "Vegetatif Awal", "Vegetatif Akhir", "Generatif", "Panen", "Bukan Padi", "Bukan Sawah"],
  topografi: ["Dataran Rendah", "Dataran Tinggi", "Pantai"],
  pola_tanam: ["Monokultur", "Campuran/Tumpangsari", "Bukan Sawah"]
};
const KOLOM = ["uuid", "id_sub", "id_polygon_asal", "sub_posisi", "petugas", "waktu", "latitude", "longitude", "akurasi_m", "altitude_m",
  "di_dalam_grid", "jarak_ke_grid_m", "jenis_tanaman", "jenis_lahan", "fase_tumbuh", "topografi", "pola_tanam", "catatan",
  "jumlah_foto", "foto", "dibuat", "diubah"];
const MAX_FOTO = 6, FOTO_PX = 1600, FOTO_Q = 0.82;
const LS_DATA = "geotag_records_v1", LS_SET = "geotag_settings_v1";

/* ================= util ================= */
const $ = s => document.querySelector(s);
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const icon = (id, cls = "") => `<svg class="${cls}"><use href="#i-${id}"/></svg>`;
function toast(msg, ms = 2400) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), ms); }
function waktuLokal(d = new Date()) {
  const p = n => String(n).padStart(2, "0"), o = -d.getTimezoneOffset(), s = o >= 0 ? "+" : "-";
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${s}${p(Math.floor(Math.abs(o) / 60))}:${p(Math.abs(o) % 60)}`;
}
const waktuPendek = iso => iso ? iso.slice(0, 16).replace("T", " ") : "";
const fmtDist = m => m >= 1000 ? (m / 1000).toFixed(2) + " km" : Math.round(m) + " m";

/* ================= penyimpanan ================= */
const store = {
  load() { try { return JSON.parse(localStorage.getItem(LS_DATA)) || []; } catch (e) { return []; } },
  save(r) { localStorage.setItem(LS_DATA, JSON.stringify(r)); },
  settings() {
    const d = { petugas: "", url: "", akurasi: 10, basemap: "Satelit", showPoints: true, showSamples: true, showGrid: true };
    try { Object.assign(d, JSON.parse(localStorage.getItem(LS_SET)) || {}); } catch (e) {}
    if (!d.url && window.CONFIG && window.CONFIG.APPS_SCRIPT_URL) d.url = window.CONFIG.APPS_SCRIPT_URL;
    return d;
  },
  saveSettings(s) { localStorage.setItem(LS_SET, JSON.stringify(s)); }
};
// Foto disimpan di IndexedDB (kapasitas jauh lebih besar dari localStorage)
const photoDB = (() => {
  let dbp;
  const db = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open("geotag", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("photos", { keyPath: "id" });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const run = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => {
    const t = d.transaction("photos", mode), req = fn(t.objectStore("photos"));
    t.oncomplete = () => res(req ? req.result : undefined); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); };
  return { put: o => run("readwrite", s => { s.put(o); }), get: id => run("readonly", s => s.get(id)), del: id => run("readwrite", s => { s.delete(id); }) };
})();
let records = store.load();
let settings = store.settings();
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
const fotoNama = (r, pid) => `${r.id_sub}_${pid.slice(0, 8)}.jpg`;

/* ================= grid ================= */
const GRID_FEATS = window.GRID.features, gridById = {};
GRID_FEATS.forEach(f => {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  f.geometry.coordinates[0].forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); });
  f.bbox = [x0, y0, x1, y1]; gridById[f.properties.id_sub] = f;
});
function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function distToGrid(lon, lat, f) {
  const [x0, y0, x1, y1] = f.bbox, dx = Math.max(x0 - lon, 0, lon - x1), dy = Math.max(y0 - lat, 0, lat - y1);
  const mx = dx * 111320 * Math.cos(lat * Math.PI / 180), my = dy * 110574; return Math.hypot(mx, my);
}
const inGrid = (loc, f) => pointInRing(loc.lon, loc.lat, f.geometry.coordinates[0]);
function locateGrid(lon, lat) {
  for (const f of GRID_FEATS) if (pointInRing(lon, lat, f.geometry.coordinates[0])) return { feat: f, inside: true, dist: 0 };
  let best = null, bd = Infinity; for (const f of GRID_FEATS) { const d = distToGrid(lon, lat, f); if (d < bd) { bd = d; best = f; } }
  return { feat: best, inside: false, dist: bd };
}
const taggedSet = () => new Set(records.map(r => r.id_sub));
// Sampel = polygon asal (gabungan 9 sub-grid)
const SAMPLES = (() => {
  const m = {};
  GRID_FEATS.forEach(f => {
    const p = f.properties, n = p.id_polygon_asal;
    const o = m[n] || (m[n] = { no: n, subs: [], bbox: [1e9, 1e9, -1e9, -1e9], induk: null, desa: null, kec: null });
    o.subs.push(p.id_sub);
    o.bbox = [Math.min(o.bbox[0], f.bbox[0]), Math.min(o.bbox[1], f.bbox[1]), Math.max(o.bbox[2], f.bbox[2]), Math.max(o.bbox[3], f.bbox[3])];
    if (p.sub_baris === 2 && p.sub_kolom === 2) { o.induk = p.id_induk; o.desa = p.nmdesa_right; o.kec = p.nmkec_right; }
  });
  return Object.values(m).sort((a, b) => a.no - b.no);
})();
const sampleOf = id => gridById[id] && SAMPLES.find(s => s.no === gridById[id].properties.id_polygon_asal);
const sampleBounds = s => L.latLngBounds([s.bbox[1], s.bbox[0]], [s.bbox[3], s.bbox[2]]);
const accClass = a => a == null ? "" : a <= settings.akurasi ? "ok" : a <= settings.akurasi * 3 ? "mid" : "bad";

/* ================= peta ================= */
const map = L.map("map", { zoomControl: false, attributionControl: true });
const baseLayers = {
  Satelit: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 21, maxNativeZoom: 19, attribution: "Esri" }),
  Peta: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 21, maxNativeZoom: 19, attribution: "© OpenStreetMap" })
};
let currentBase = null;
function setBase(name) { if (!baseLayers[name]) name = "Satelit"; if (currentBase) map.removeLayer(currentBase); currentBase = baseLayers[name].addTo(map); settings.basemap = name; }
setBase(settings.basemap);

let selectedId = null, gridPopup = null;
function gridStyle(f) {
  const id = f.properties.id_sub;
  if (id === selectedId) return { color: "#fbbf24", weight: 3.5, fillColor: "#fbbf24", fillOpacity: .28 };
  return taggedSet().has(id)
    ? { color: "#34d399", weight: 2, fillColor: "#10b981", fillOpacity: .42 }
    : { color: "#ffffff", weight: 2.2, fillColor: "#ffffff", fillOpacity: .12, dashArray: "6 4" };
}
const gridLayer = L.geoJSON(window.GRID, {
  style: gridStyle,
  onEachFeature: (f, layer) => {
    layer.bindTooltip(f.properties.id_sub, { permanent: true, direction: "center", className: "grid-label" });
    layer.on("click", () => {
      const p = f.properties, n = records.filter(r => r.id_sub === p.id_sub).length;
      map.closePopup(); selectedId = p.id_sub; gridLayer.setStyle(gridStyle);
      gridPopup = L.popup({ closeButton: false }).setLatLng(layer.getBounds().getCenter()).setContent(
        `<div class="pop-title">Grid ${esc(p.id_sub)}</div>
         <div class="pop-sub">Polygon ${p.id_polygon_asal} · ${esc(p.sub_posisi.replace("_", " "))} · ${n ? `<b style="color:#059669">sudah di-tag ${n}×</b>` : "belum di-tag"}</div>
         <div class="pop-actions">
           <button class="btn btn-primary btn-sm" onclick="openForm(null,'${p.id_sub}')">${icon("pin")}Tag grid ini</button>
           <button class="btn btn-soft btn-sm" onclick="navigasi('${p.id_sub}')">${icon("nav")}Arahkan (Google Maps)</button>
         </div>`).openOn(map);
    });
  }
}).addTo(map);
map.on("popupclose", e => { if (e.popup === gridPopup) { gridPopup = null; selectedId = null; gridLayer.setStyle(gridStyle); } });
map.fitBounds(gridLayer.getBounds(), { padding: [40, 40] });
function updateLabels() { const show = map.getZoom() >= 17; map.getContainer().classList.toggle("compact", map.getZoom() < 16); gridLayer.eachLayer(l => { const t = l.getTooltip(); if (t) t.setOpacity(show ? 1 : 0); }); }
map.on("zoomend", updateLabels); updateLabels();
function refreshGrid() {
  gridLayer.setStyle(gridStyle); drawSamples(); drawPoints(); applyLayerVis();
  const n = records.length; $("#nData").textContent = n; $("#nData").style.display = n ? "" : "none";
  $("#progressText").textContent = `${taggedSet().size}/${GRID_FEATS.length} grid di-tag`;
}
/* ---------- batas sampel ---------- */
const samplesLayer = L.layerGroup();
function drawSamples() {
  samplesLayer.clearLayers(); const tg = taggedSet();
  SAMPLES.forEach(sm => {
    const b = sampleBounds(sm), done = sm.subs.filter(id => tg.has(id)).length, full = done === sm.subs.length;
    L.rectangle(b, { color: full ? "#10b981" : "#f59e0b", weight: 3.5, fill: false, interactive: false }).addTo(samplesLayer);
    L.marker([sm.bbox[3], (sm.bbox[0] + sm.bbox[2]) / 2], {
      icon: L.divIcon({ className: "sample-label-wrap", iconSize: [0, 0],
        html: `<div class="sample-label ${full ? "done" : ""}"><span class="full">Sampel </span>${sm.no}<i>${done}/${sm.subs.length}</i></div>` }),
      zIndexOffset: 500
    }).on("click", () => map.fitBounds(b, { padding: [30, 30], maxZoom: 18 })).addTo(samplesLayer);
  });
}
/* ---------- titik tagging ---------- */
const pointsLayer = L.layerGroup();
function drawPoints() {
  pointsLayer.clearLayers();
  records.forEach(r => {
    const inside = r.di_dalam_grid === "Ya";
    L.circleMarker([r.latitude, r.longitude], { radius: 8, color: "#fff", weight: 3, fillColor: inside ? "#7c3aed" : "#ea580c", fillOpacity: 1 })
      .bindPopup(() => pointPopup(r), { closeButton: false, minWidth: 220, maxWidth: 260 })
      .addTo(pointsLayer);
  });
}
function pointPopup(r) {
  const el = document.createElement("div"), nf = (r.foto || []).length;
  el.innerHTML = `<div class="pop-title">Grid ${esc(r.id_sub)}</div>
    <div class="pop-sub">Sampel ${r.id_polygon_asal} · ${waktuPendek(r.waktu)} · ±${Math.round(r.akurasi_m)} m</div>
    ${nf ? `<div class="pop-photo"></div>` : ""}
    <div class="pop-kv"><span>Tanaman</span> ${esc(r.jenis_tanaman)}<br><span>Lahan</span> ${esc(r.jenis_lahan)}<br>
      <span>Fase</span> ${esc(r.fase_tumbuh)}<br><span>Topografi</span> ${esc(r.topografi)} · <span>Pola</span> ${esc(r.pola_tanam)}
      ${r.catatan ? `<br><span>Catatan</span> ${esc(r.catatan)}` : ""}
      ${r.di_dalam_grid === "Ya" ? "" : `<br><b class="t-warn">Di luar grid (${r.jarak_ke_grid_m} m)</b>`}</div>
    <div class="pop-actions"><button class="btn btn-soft btn-sm">Ubah data</button></div>`;
  el.querySelector("button").onclick = () => openForm(r.uuid);
  if (nf) photoDB.get(r.foto[0]).then(o => { if (!o) return; const u = URL.createObjectURL(o.blob), ph = el.querySelector(".pop-photo");
    ph.style.backgroundImage = `url(${u})`; ph.onclick = () => { $("#viewerImg").src = u; $("#viewer").classList.add("open"); };
    }).catch(() => {});
  return el;
}
function applyLayerVis() {
  const set = (lyr, on) => on ? (map.hasLayer(lyr) || lyr.addTo(map)) : map.removeLayer(lyr);
  set(gridLayer, settings.showGrid); set(samplesLayer, settings.showSamples); set(pointsLayer, settings.showPoints);
  if (settings.showPoints) pointsLayer.eachLayer(l => l.bringToFront && l.bringToFront());
  if (userMarker) { accCircle.bringToFront(); userMarker.bringToFront(); }
}

window.navigasi = id => {
  const c = L.geoJSON(gridById[id]).getBounds().getCenter();
  window.open(`https://www.google.com/maps/dir/?api=1&destination=${c.lat.toFixed(7)},${c.lng.toFixed(7)}&travelmode=walking`, "_blank");
};

/* ================= GPS ================= */
let lastFix = null, userMarker = null, accCircle = null, centeredOnce = false;
function onFix(p) {
  const c = p.coords; lastFix = { lat: c.latitude, lon: c.longitude, acc: c.accuracy, alt: c.altitude, t: p.timestamp };
  const ll = [c.latitude, c.longitude];
  if (!userMarker) {
    accCircle = L.circle(ll, { radius: c.accuracy, color: "#3b82f6", weight: 1, fillColor: "#3b82f6", fillOpacity: .12, interactive: false }).addTo(map);
    userMarker = L.circleMarker(ll, { radius: 8, color: "#fff", weight: 3, fillColor: "#2563eb", fillOpacity: 1 }).addTo(map);
  } else { userMarker.setLatLng(ll); accCircle.setLatLng(ll).setRadius(c.accuracy); }
  const k = accClass(c.accuracy);
  $("#gpsDot").className = "dot " + k;
  $("#accPill").className = "pill " + k; $("#accPill").textContent = `±${Math.round(c.accuracy)} m`;
  const g = locateGrid(c.longitude, c.latitude), id = g.feat.properties.id_sub, sudah = taggedSet().has(id);
  if (g.inside) {
    $("#dockTitle").textContent = `Grid ${id}`;
    $("#dockSub").textContent = `Sampel ${g.feat.properties.id_polygon_asal} · ` + (sudah ? "sudah di-tag" : "belum di-tag");
    $("#btnTagText").textContent = `Tag grid ${id}`;
  } else {
    $("#dockTitle").textContent = "Di luar grid";
    $("#dockSub").textContent = `Terdekat: sampel ${g.feat.properties.id_polygon_asal}, grid ${id} · ${fmtDist(g.dist)}`;
    $("#btnTagText").textContent = "Tag di sini";
  }
  if (!centeredOnce && g.dist < 2000) { centeredOnce = true; map.setView(ll, 18); }
}
function onGpsErr(e) {
  $("#gpsDot").className = "dot bad"; $("#accPill").className = "pill bad"; $("#accPill").textContent = "GPS mati";
  $("#dockTitle").textContent = e.code === 1 ? "Izin lokasi ditolak" : "GPS belum tersedia";
  $("#dockSub").textContent = e.code === 1 ? "Aktifkan izin lokasi untuk situs ini" : (e.message || "Coba di tempat terbuka");
}
let watchId = null;
function startWatch() {
  if (!("geolocation" in navigator)) { $("#dockTitle").textContent = "Browser tidak mendukung GPS"; return; }
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(onFix, onGpsErr, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
}
startWatch();

// Ambil posisi terbaik dalam beberapa detik
function captureBest(maxMs, onProgress) {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error("GPS tidak tersedia"));
    let best = null; const t0 = Date.now();
    const pack = p => ({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, alt: p.coords.altitude, t: p.timestamp });
    const id = navigator.geolocation.watchPosition(p => {
      onFix(p); if (!best || p.coords.accuracy < best.coords.accuracy) best = p;
      onProgress && onProgress(pack(best), Math.max(0, Math.ceil((maxMs - (Date.now() - t0)) / 1000)));
      if (best.coords.accuracy <= settings.akurasi && Date.now() - t0 > 3000) finish();
    }, e => { if (e.code === 1) { clearTimeout(h); navigator.geolocation.clearWatch(id); reject(e); } },
    { enableHighAccuracy: true, maximumAge: 0, timeout: maxMs + 5000 });
    const h = setTimeout(finish, maxMs);
    function finish() {
      clearTimeout(h); navigator.geolocation.clearWatch(id);
      // jika tidak ada posisi baru, pakai posisi terakhir yang masih segar (< 30 dtk)
      const recent = lastFix && Date.now() - lastFix.t < 30000 ? { ...lastFix } : null;
      const b = best ? pack(best) : null;
      const pick = b && (!recent || b.acc <= recent.acc) ? b : recent;
      pick ? resolve(pick) : reject(new Error("Tidak mendapat posisi GPS"));
    }
  });
}

/* ================= halaman ================= */
function openPage(id) { const p = document.getElementById(id); p.classList.add("open"); p.setAttribute("aria-hidden", "false"); }
function closePage(id) { const p = document.getElementById(id); p.classList.remove("open"); p.setAttribute("aria-hidden", "true"); if (id === "pageForm") cleanupForm(); }
document.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => closePage(b.dataset.close)));

/* ================= form ================= */
let formLoc = null, editingId = null, formPhotos = [], removedPhotos = [], capturing = false;

function buildSelects() {
  Object.entries(OPSI).forEach(([k, opts]) => {
    const s = $("#f_" + k);
    s.innerHTML = `<option value="" disabled selected hidden>Pilih ${s.closest(".field").querySelector("span").textContent.toLowerCase()}…</option>` +
      opts.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
    s.required = true;
    s.addEventListener("change", () => { s.closest(".field").classList.remove("err"); if (k === "jenis_lahan") applyRules(); });
  });
  $("#fGrid").innerHTML = GRID_FEATS.map(f => `<option value="${esc(f.properties.id_sub)}">Grid ${esc(f.properties.id_sub)} — polygon ${f.properties.id_polygon_asal}, ${esc(f.properties.sub_posisi.replace("_", " "))}</option>`).join("");
  $("#fGrid").addEventListener("change", () => { renderLoc(); $("#formSub").textContent = "Grid " + $("#fGrid").value; });
  $("#fTanaman").addEventListener("input", () => $("#fTanaman").closest(".field").classList.remove("err"));
}
// Aturan konsistensi: Bukan Sawah ↔ fase & pola
function applyRules() {
  const lahan = $("#f_jenis_lahan").value, bukan = lahan === "Bukan Sawah";
  ["fase_tumbuh", "pola_tanam"].forEach(k => {
    const s = $("#f_" + k);
    [...s.options].forEach(o => { if (o.value) o.disabled = lahan ? (bukan ? o.value !== "Bukan Sawah" : o.value === "Bukan Sawah") : false; });
    if (bukan) { s.value = "Bukan Sawah"; s.disabled = true; s.closest(".field").classList.remove("err"); }
    else { s.disabled = false; if (s.value === "Bukan Sawah") s.value = ""; }
  });
}
function renderLoc(msg) {
  const f = gridById[$("#fGrid").value];
  if (!formLoc) { $("#lCoord").textContent = msg || "Menunggu GPS…"; $("#lAcc").textContent = "—"; $("#lPos").textContent = "—"; return; }
  $("#lCoord").textContent = `${formLoc.lat.toFixed(6)}, ${formLoc.lon.toFixed(6)}`;
  const k = accClass(formLoc.acc);
  $("#lAcc").innerHTML = `<span class="t-${k === "ok" ? "ok" : k === "mid" ? "warn" : "bad"}">±${formLoc.acc.toFixed(1)} m</span>`;
  $("#lPos").innerHTML = inGrid(formLoc, f) ? `<span class="t-ok">✓ Di dalam grid</span>` : `<span class="t-bad">Di luar grid · ${fmtDist(distToGrid(formLoc.lon, formLoc.lat, f))}</span>`;
}
window.openForm = function (recId, gridId) {
  map.closePopup(); cleanupForm(); closePage("pageData");
  if (!settings.petugas) { toast("Isi nama petugas dulu"); openSettings(); return; }
  editingId = recId || null;
  const rec = recId ? records.find(r => r.uuid === recId) : null;
  $("#formTitle").textContent = rec ? "Ubah Data" : "Tagging Grid";
  document.querySelectorAll("#pageForm .field").forEach(f => f.classList.remove("err"));
  Object.keys(OPSI).forEach(k => { const s = $("#f_" + k); s.disabled = false; [...s.options].forEach(o => o.disabled = !o.value); s.value = rec ? rec[k] : ""; });
  applyRules(); if (rec) Object.keys(OPSI).forEach(k => { if (!$("#f_" + k).disabled) $("#f_" + k).value = rec[k]; });
  $("#fTanaman").value = rec ? rec.jenis_tanaman : ""; $("#fCatatan").value = rec ? rec.catatan : "";
  $("#dlTanaman").innerHTML = [...new Set(["Padi", "Jagung", "Kedelai", "Singkong", ...records.map(r => r.jenis_tanaman).filter(Boolean)])].map(v => `<option value="${esc(v)}">`).join("");
  if (rec) {
    $("#fGrid").value = rec.id_sub;
    formLoc = { lat: rec.latitude, lon: rec.longitude, acc: rec.akurasi_m, alt: rec.altitude_m, t: Date.parse(rec.waktu) };
    formPhotos = (rec.foto || []).map(id => ({ id, blob: null, isNew: false }));
    Promise.all(formPhotos.map(async p => { const o = await photoDB.get(p.id); p.blob = o ? o.blob : null; })).then(renderPhotos);
  } else {
    formLoc = lastFix ? { ...lastFix } : null;
    const gid = gridId || (lastFix ? locateGrid(lastFix.lon, lastFix.lat).feat.properties.id_sub : null) || GRID_FEATS[0].properties.id_sub;
    $("#fGrid").value = gid;
  }
  $("#formSub").textContent = "Grid " + $("#fGrid").value;
  renderLoc(); renderPhotos(); openPage("pageForm"); $("#pageForm .page-body").scrollTop = 0;
  if (!rec) doCapture(8000);
};
async function doCapture(ms = 15000) {
  if (capturing) return; capturing = true; const b = $("#btnCapture"); b.disabled = true;
  b.querySelector("svg").classList.add("spin");
  try {
    formLoc = await captureBest(ms, (loc, s) => { formLoc = loc; renderLoc(); $("#captureText").textContent = `Mencari akurasi terbaik… ${s} dtk`; });
    renderLoc();
  } catch (e) { if (!formLoc) renderLoc("Gagal: " + (e.message || e)); toast("Gagal mengambil lokasi GPS"); }
  finally { capturing = false; b.disabled = false; b.querySelector("svg").classList.remove("spin"); $("#captureText").textContent = "Perbarui lokasi"; }
}
$("#btnCapture").onclick = () => doCapture(15000);

/* ---------- foto ---------- */
let photoUrls = [];
function renderPhotos() {
  photoUrls.forEach(u => URL.revokeObjectURL(u)); photoUrls = [];
  const html = formPhotos.map((p, i) => {
    const u = p.blob ? URL.createObjectURL(p.blob) : ""; if (u) photoUrls.push(u);
    return `<div class="ph">${u ? `<img src="${u}" alt="" data-view="${i}">` : ""}<button class="del" data-del="${i}" aria-label="Hapus foto">${icon("x")}</button></div>`;
  }).join("");
  const add = formPhotos.length < MAX_FOTO ? `<button class="ph-add" id="btnAddPhoto">${icon("camera")}<span>Ambil foto</span></button>` : "";
  $("#photoGrid").innerHTML = html + add;
  $("#photoCount").textContent = formPhotos.length ? `· ${formPhotos.length}/${MAX_FOTO}` : "";
  const a = $("#btnAddPhoto"); if (a) a.onclick = () => $("#photoInput").click();
  $("#photoGrid").querySelectorAll("[data-del]").forEach(b => b.onclick = () => {
    const p = formPhotos.splice(+b.dataset.del, 1)[0]; if (!p.isNew) removedPhotos.push(p.id); renderPhotos(); });
  $("#photoGrid").querySelectorAll("[data-view]").forEach(img => img.onclick = () => { $("#viewerImg").src = img.src; $("#viewer").classList.add("open"); });
}
$("#viewerClose").onclick = () => $("#viewer").classList.remove("open");
$("#viewer").onclick = e => { if (e.target.id === "viewer") $("#viewer").classList.remove("open"); };
$("#photoInput").addEventListener("change", async e => {
  const files = [...e.target.files]; e.target.value = ""; if (!files.length) return;
  const a = $("#btnAddPhoto"); if (a) { a.classList.add("busy"); a.querySelector("span").textContent = "Memproses…"; }
  try {
    for (const file of files.slice(0, MAX_FOTO - formPhotos.length)) formPhotos.push({ id: uuid(), blob: await processPhoto(file), isNew: true });
  } catch (err) { toast("Foto gagal diproses"); console.error(err); }
  renderPhotos();
});
function loadImg(file) {
  return new Promise((res, rej) => { const u = URL.createObjectURL(file), img = new Image();
    img.onload = () => { URL.revokeObjectURL(u); res(img); }; img.onerror = () => { URL.revokeObjectURL(u); rej(new Error("gambar tidak terbaca")); }; img.src = u; });
}
// Perkecil foto + beri keterangan (grid, koordinat, akurasi, waktu, petugas)
async function processPhoto(file) {
  const img = await loadImg(file);
  const s = Math.min(1, FOTO_PX / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d"); g.drawImage(img, 0, 0, w, h);
  const loc = formLoc || lastFix, f = gridById[$("#fGrid").value];
  const lines = [
    `Grid ${f.properties.id_sub} · polygon ${f.properties.id_polygon_asal} ${f.properties.sub_posisi.replace("_", " ")}`,
    loc ? `${loc.lat.toFixed(6)}, ${loc.lon.toFixed(6)}  ±${Math.round(loc.acc)} m` : "Lokasi GPS belum tersedia",
    `${waktuPendek(waktuLokal())} · ${settings.petugas}`
  ];
  const fs = Math.max(14, Math.round(w * 0.026)), pad = Math.round(fs * .7), lh = Math.round(fs * 1.35), bh = lines.length * lh + pad * 2;
  const grad = g.createLinearGradient(0, h - bh - pad * 2, 0, h);
  grad.addColorStop(0, "rgba(0,0,0,0)"); grad.addColorStop(.35, "rgba(0,0,0,.55)"); grad.addColorStop(1, "rgba(0,0,0,.7)");
  g.fillStyle = grad; g.fillRect(0, h - bh - pad * 2, w, bh + pad * 2);
  g.fillStyle = "#fff"; g.textBaseline = "top"; g.shadowColor = "rgba(0,0,0,.6)"; g.shadowBlur = 3;
  lines.forEach((t, i) => { g.font = `${i === 0 ? 700 : 500} ${fs}px system-ui, sans-serif`; g.fillText(t, pad, h - bh + pad * .2 + i * lh); });
  return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error("toBlob gagal")), "image/jpeg", FOTO_Q));
}
function cleanupForm() { photoUrls.forEach(u => URL.revokeObjectURL(u)); photoUrls = []; formPhotos = []; removedPhotos = []; }

/* ---------- simpan ---------- */
$("#btnSave").onclick = async () => {
  const v = { jenis_tanaman: $("#fTanaman").value.trim(), catatan: $("#fCatatan").value.trim() };
  Object.keys(OPSI).forEach(k => v[k] = $("#f_" + k).value);
  const salah = [];
  if (!v.jenis_tanaman) { salah.push("Jenis tanaman"); $("#fTanaman").closest(".field").classList.add("err"); }
  Object.keys(OPSI).forEach(k => { if (!v[k]) { salah.push($("#f_" + k).closest(".field").querySelector("span").textContent); $("#f_" + k).closest(".field").classList.add("err"); } });
  if (!formLoc) salah.push("Lokasi GPS");
  if (salah.length) { toast("Lengkapi: " + salah.join(", "), 3500); const e = document.querySelector("#pageForm .field.err"); if (e) e.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
  const id = $("#fGrid").value, f = gridById[id], inside = inGrid(formLoc, f), dist = distToGrid(formLoc.lon, formLoc.lat, f);
  if (!inside && !confirm(`Lokasi berada di LUAR grid ${id} (± ${fmtDist(dist)}). Tetap simpan?`)) return;
  if (formLoc.acc > settings.akurasi * 3 && !confirm(`Akurasi GPS kurang baik (±${formLoc.acc.toFixed(0)} m). Tetap simpan?`)) return;
  if (!formPhotos.length && !confirm("Belum ada foto. Simpan tanpa foto?")) return;

  $("#btnSave").disabled = true;
  try {
    const now = waktuLokal(), recId = editingId || uuid();
    for (const p of formPhotos) if (p.isNew) await photoDB.put({ id: p.id, rec: recId, blob: p.blob });
    for (const pid of removedPhotos) await photoDB.del(pid);
    const base = {
      id_sub: id, id_polygon_asal: f.properties.id_polygon_asal, sub_posisi: f.properties.sub_posisi, petugas: settings.petugas,
      latitude: +formLoc.lat.toFixed(8), longitude: +formLoc.lon.toFixed(8), akurasi_m: +formLoc.acc.toFixed(2),
      altitude_m: formLoc.alt == null ? null : +formLoc.alt.toFixed(1), di_dalam_grid: inside ? "Ya" : "Tidak", jarak_ke_grid_m: +dist.toFixed(1),
      foto: formPhotos.map(p => p.id), ...v
    };
    if (editingId) {
      const r = records.find(r => r.uuid === editingId);
      Object.assign(r, base, { waktu: formLoc.t ? waktuLokal(new Date(formLoc.t)) : r.waktu, diubah: now, synced: false });
    } else records.push({ uuid: recId, waktu: formLoc.t ? waktuLokal(new Date(formLoc.t)) : now, dibuat: now, diubah: "", synced: false, foto_terkirim: [], ...base });
    store.save(records);
    closePage("pageForm"); refreshGrid(); renderList(); toast(`✓ Tersimpan · grid ${id}`);
    if (lastFix) onFix({ coords: { latitude: lastFix.lat, longitude: lastFix.lon, accuracy: lastFix.acc, altitude: lastFix.alt }, timestamp: lastFix.t });
    if (settings.url) syncData(true);
  } catch (e) { alert("Gagal menyimpan: " + (e.message || e)); }
  finally { $("#btnSave").disabled = false; }
};

/* ================= daftar data ================= */
let listUrls = [];
async function renderList() {
  const n = records.length, pend = records.filter(r => !r.synced).length;
  $("#stData").textContent = n; $("#stGrid").textContent = taggedSet().size;
  $("#stFoto").textContent = records.reduce((a, r) => a + (r.foto || []).length, 0);
  $("#stPend").textContent = settings.url ? pend : "–"; $("#stPendBox").classList.toggle("alert", !!(settings.url && pend));
  listUrls.forEach(u => URL.revokeObjectURL(u)); listUrls = [];
  if (!n) { $("#recList").innerHTML = `<div class="empty">${icon("pin")}<div>Belum ada data.<br>Tekan <b>Tag di sini</b> di lokasi grid.</div></div>`; return; }
  $("#recList").innerHTML = records.slice().reverse().map(r => `
    <div class="rec">
      <div class="rec-thumb" data-thumb="${r.uuid}">${(r.foto || []).length ? `<span class="n">${r.foto.length}</span>` : icon("camera")}</div>
      <div class="rec-main">
        <div class="rec-top"><span class="rec-grid">Grid ${esc(r.id_sub)}</span>
          ${r.di_dalam_grid === "Ya" ? "" : `<span class="tag warn">luar grid</span>`}
          ${settings.url ? `<span class="tag ${r.synced ? "ok" : ""}">${r.synced ? "terkirim" : "belum kirim"}</span>` : ""}</div>
        <div class="rec-line">${esc(r.jenis_tanaman)} · ${esc(r.jenis_lahan)} · ${esc(r.fase_tumbuh)}</div>
        <div class="rec-meta">${waktuPendek(r.waktu)} · ±${Math.round(r.akurasi_m)} m${r.catatan ? " · " + esc(r.catatan) : ""}</div>
        <div class="rec-acts">
          <button class="btn btn-soft btn-sm" onclick="lihat('${r.uuid}')">${icon("pin")}Peta</button>
          <button class="btn btn-soft btn-sm" onclick="openForm('${r.uuid}')">Ubah</button>
          <button class="btn btn-danger btn-sm" onclick="hapus('${r.uuid}')">Hapus</button>
        </div>
      </div>
    </div>`).join("");
  for (const r of records) if ((r.foto || []).length) {
    const o = await photoDB.get(r.foto[0]).catch(() => null), el = document.querySelector(`[data-thumb="${r.uuid}"]`);
    if (o && el) { const u = URL.createObjectURL(o.blob); listUrls.push(u); el.style.backgroundImage = `url(${u})`; }
  }
}
window.lihat = id => {
  const r = records.find(r => r.uuid === id); closePage("pageData");
  if (!settings.showPoints) { settings.showPoints = true; store.saveSettings(settings); applyLayerVis(); }
  map.setView([r.latitude, r.longitude], 19);
  L.popup({ closeButton: false, minWidth: 220, maxWidth: 260 }).setLatLng([r.latitude, r.longitude]).setContent(pointPopup(r)).openOn(map);
};
window.hapus = async id => {
  const r = records.find(r => r.uuid === id);
  if (!confirm(`Hapus data grid ${r.id_sub} (${waktuPendek(r.waktu)}) beserta fotonya?`)) return;
  for (const pid of r.foto || []) await photoDB.del(pid).catch(() => {});
  records = records.filter(x => x.uuid !== id); store.save(records); refreshGrid(); renderList(); toast("Data dihapus");
};

/* ================= ekspor ================= */
const rowOf = r => Object.fromEntries(KOLOM.map(k => [k,
  k === "jumlah_foto" ? (r.foto || []).length : k === "foto" ? (r.foto || []).map(p => fotoNama(r, p)).join("; ") : (r[k] ?? "")]));
function toCsv() {
  const q = v => { v = v == null ? "" : String(v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  return "﻿" + [KOLOM.join(","), ...records.map(r => { const o = rowOf(r); return KOLOM.map(k => q(o[k])).join(","); })].join("\r\n");
}
function toGeojson() {
  return JSON.stringify({ type: "FeatureCollection", features: records.map(r => ({ type: "Feature",
    geometry: { type: "Point", coordinates: [r.longitude, r.latitude] }, properties: rowOf(r) })) }, null, 1);
}
function download(name, blob) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
const stamp = () => waktuLokal().slice(0, 16).replace(/[-:]/g, "").replace("T", "_");
$("#btnCsv").onclick = () => records.length ? download(`geotag_${stamp()}.csv`, new Blob([toCsv()], { type: "text/csv;charset=utf-8" })) : toast("Belum ada data");
$("#btnGeojson").onclick = () => records.length ? download(`geotag_${stamp()}.geojson`, new Blob([toGeojson()], { type: "application/geo+json" })) : toast("Belum ada data");
$("#btnZip").onclick = async () => {
  if (!records.length) return toast("Belum ada data");
  const b = $("#btnZip"); b.disabled = true; toast("Menyiapkan ZIP…");
  try {
    const files = [{ name: "data.csv", data: toCsv() }, { name: "data.geojson", data: toGeojson() }];
    for (const r of records) for (const pid of r.foto || []) { const o = await photoDB.get(pid); if (o) files.push({ name: "foto/" + fotoNama(r, pid), data: o.blob }); }
    download(`geotag_${stamp()}.zip`, await Zip.make(files)); toast(`ZIP siap · ${files.length - 2} foto`);
  } catch (e) { alert("Gagal membuat ZIP: " + (e.message || e)); }
  finally { b.disabled = false; }
};

/* ================= kirim ke Google Sheets + Drive ================= */
const toB64 = blob => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.onerror = () => rej(fr.error); fr.readAsDataURL(blob); });
let syncing = false;
async function syncData(silent) {
  if (!settings.url) { if (!silent) { toast("Isi URL Google Apps Script di Pengaturan"); openSettings(); } return; }
  const pend = records.filter(r => !r.synced);
  if (!pend.length) { if (!silent) toast("Semua data sudah terkirim"); return; }
  if (!navigator.onLine) { if (!silent) toast("Tidak ada internet"); return; }
  if (syncing) return; syncing = true; $("#btnSync").disabled = true;
  let ok = 0, err = "";
  try {
    for (const [i, r] of pend.entries()) {
      $("#syncText").textContent = `Mengirim ${i + 1}/${pend.length}…`;
      const sent = new Set(r.foto_terkirim || []), photos = [];
      for (const pid of r.foto || []) if (!sent.has(pid)) { const o = await photoDB.get(pid); if (o) photos.push({ id: pid, name: fotoNama(r, pid), data: await toB64(o.blob) }); }
      try {
        const res = await fetch(settings.url, { method: "POST", body: JSON.stringify({ record: rowOf(r), photos: photos.map(({ name, data }) => ({ name, data })) }) });
        const j = await res.json(); if (!j.ok) throw new Error(j.error || "respon tidak valid");
        r.synced = true; r.foto_terkirim = [...(r.foto || [])]; ok++; store.save(records);
      } catch (e) { err = e.message || String(e); }
    }
  } finally {
    syncing = false; $("#btnSync").disabled = false; $("#syncText").textContent = "Kirim ke Google Sheets"; renderList();
    if (ok) toast(`✓ Terkirim ${ok} data`); if (err && !silent) alert("Sebagian gagal dikirim: " + err);
  }
}
$("#btnSync").onclick = () => syncData(false);
window.addEventListener("online", () => syncData(true));

/* ================= tombol & pengaturan ================= */
$("#btnCenter").onclick = () => { if (lastFix) map.setView([lastFix.lat, lastFix.lon], Math.max(map.getZoom(), 18)); else { toast("Menunggu GPS…"); startWatch(); } };
/* panel lapisan */
function syncLayerPanel() {
  document.querySelectorAll("#segBase button").forEach(b => b.classList.toggle("on", b.dataset.base === settings.basemap));
  $("#tgPoints").checked = settings.showPoints; $("#tgSamples").checked = settings.showSamples; $("#tgGrid").checked = settings.showGrid;
}
$("#btnLayer").onclick = e => { e.stopPropagation(); syncLayerPanel(); $("#layerPanel").classList.toggle("open"); $("#btnLayer").classList.toggle("on", $("#layerPanel").classList.contains("open")); };
const closeLayerPanel = () => { $("#layerPanel").classList.remove("open"); $("#btnLayer").classList.remove("on"); };
map.on("click movestart", closeLayerPanel);
document.querySelectorAll("#segBase button").forEach(b => b.onclick = () => { setBase(b.dataset.base); store.saveSettings(settings); syncLayerPanel(); });
[["tgPoints", "showPoints"], ["tgSamples", "showSamples"], ["tgGrid", "showGrid"]].forEach(([id, k]) =>
  $("#" + id).addEventListener("change", e => { settings[k] = e.target.checked; store.saveSettings(settings); applyLayerVis(); }));

/* daftar sampel */
function renderSamples() {
  const tg = taggedSet(), here = lastFix ? locateGrid(lastFix.lon, lastFix.lat) : null;
  const selesai = SAMPLES.filter(sm => sm.subs.every(id => tg.has(id))).length;
  $("#samplesSub").textContent = `${SAMPLES.length} sampel · ${selesai} selesai · ${tg.size}/${GRID_FEATS.length} sub-grid`;
  $("#sampleList").innerHTML = SAMPLES.map(sm => {
    const order = [...sm.subs].sort((a, b) => { const pa = gridById[a].properties, pb = gridById[b].properties; return pa.sub_baris - pb.sub_baris || pa.sub_kolom - pb.sub_kolom; });
    const done = sm.subs.filter(id => tg.has(id)).length, n = records.filter(r => r.id_polygon_asal === sm.no).length;
    let jarak = "";
    if (lastFix) { const d = Math.min(...sm.subs.map(id => distToGrid(lastFix.lon, lastFix.lat, gridById[id]))); jarak = d === 0 ? " · <b class='t-ok'>Anda di sini</b>" : ` · ${fmtDist(d)}`; }
    return `<button class="sample ${done === sm.subs.length ? "done" : ""}" data-sample="${sm.no}">
      <div class="mini">${order.map(id => `<i class="${tg.has(id) ? "on" : ""} ${here && here.inside && here.feat.properties.id_sub === id ? "here" : ""}"></i>`).join("")}</div>
      <div class="s-main">
        <div class="s-title">Sampel ${sm.no}${done === sm.subs.length ? `<span class="tag ok">selesai</span>` : ""}</div>
        <div class="s-sub">${done}/${sm.subs.length} sub-grid · ${n} titik${jarak}${sm.desa ? `<br>${esc(sm.desa)}, ${esc(sm.kec || "")}` : ""}</div>
        <div class="bar"><i style="width:${done / sm.subs.length * 100}%"></i></div>
      </div>
      <svg class="s-go"><use href="#i-nav"/></svg>
    </button>`;
  }).join("");
  $("#sampleList").querySelectorAll("[data-sample]").forEach(b => b.onclick = () => {
    const sm = SAMPLES.find(x => x.no === +b.dataset.sample); closePage("pageSamples");
    map.fitBounds(sampleBounds(sm), { padding: [40, 40], maxZoom: 18 });
  });
}
$("#btnSamples").onclick = () => { renderSamples(); openPage("pageSamples"); };
$("#btnTag").onclick = () => openForm(null, null);
$("#btnData").onclick = () => { renderList(); openPage("pageData"); };
function openSettings() { $("#sPetugas").value = settings.petugas; $("#sUrl").value = settings.url; $("#sAkurasi").value = String(settings.akurasi); openPage("pageSettings"); }
$("#btnSettings").onclick = openSettings;
$("#btnSetSave").onclick = () => {
  const nama = $("#sPetugas").value.trim(); if (!nama) { $("#sPetugas").closest(".field").classList.add("err"); toast("Nama petugas wajib diisi"); return; }
  $("#sPetugas").closest(".field").classList.remove("err");
  settings.petugas = nama; settings.url = $("#sUrl").value.trim(); settings.akurasi = +$("#sAkurasi").value || 10;
  store.saveSettings(settings); closePage("pageSettings"); renderList(); toast("Pengaturan disimpan");
  if (lastFix) onFix({ coords: { latitude: lastFix.lat, longitude: lastFix.lon, accuracy: lastFix.acc, altitude: lastFix.alt }, timestamp: lastFix.t });
};
$("#ver").textContent = APP_VERSION;

buildSelects(); refreshGrid(); renderList();
if (!settings.petugas) setTimeout(openSettings, 500);
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
