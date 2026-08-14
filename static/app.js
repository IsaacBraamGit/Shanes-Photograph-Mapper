/* Scout — photoshoot location finder. Vanilla JS + Leaflet. */

const CATS = {
  "editorial-fashion": { label: "editorial", color: "#e8b21f" },
  "streetwear":        { label: "streetwear", color: "#e4562a" },
  "portrait":          { label: "portrait", color: "#d98cae" },
  "nature":            { label: "nature", color: "#4caf7d" },
  "industrial":        { label: "industrial", color: "#9aa4b2" },
  "luxury":            { label: "luxury", color: "#c9a227" },
  "golden-hour":       { label: "golden hour", color: "#f4a94a" },
  "moody-neon":        { label: "moody neon", color: "#b14aff" },
  "architecture":      { label: "architecture", color: "#4aa3c7" },
  "beach":             { label: "beach", color: "#48c9d6" },
};
const catColor = (c) => (CATS[c] && CATS[c].color) || "#888";
const catLabel = (c) => (CATS[c] && CATS[c].label) || c;

const state = {
  all: [],
  filtered: [],
  activeCats: new Set(),
  search: "",
  minWarm: -100,
  minBright: 0,
  activeId: null,
  routeMode: false,
  route: [],          // ordered ids
  markers: new Map(),
  routeLine: null,
  capture: null,      // {dataUrl, analysis, gps}
};

/* ---------- Map ---------- */
const map = L.map("map", { zoomControl: true, attributionControl: false }).setView([52.1, 4.5], 8);
// OSM standard tiles (reliably reachable); inverted to a dark theme via CSS in styles.css
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
}).addTo(map);

function pinIcon(color, num) {
  const html = num
    ? `<div class="pin num" style="background:${color}">${num}</div>`
    : `<div class="pin" style="background:${color}"></div>`;
  return L.divIcon({ html, className: "", iconSize: [22, 22], iconAnchor: [11, num ? 11 : 22] });
}

/* ---------- Load ---------- */
async function load() {
  const res = await fetch("/api/locations");
  state.all = await res.json();
  buildChips();
  applyFilters();
  if (state.all.length) {
    const b = L.latLngBounds(state.all.map(l => [l.lat, l.lng]));
    map.fitBounds(b.pad(0.15));
  }
}

/* ---------- Filters ---------- */
function buildChips() {
  const chips = document.getElementById("chips");
  const present = [...new Set(state.all.map(l => l.category))];
  chips.innerHTML = "";
  present.forEach(c => {
    const el = document.createElement("button");
    el.className = "chip";
    el.textContent = catLabel(c);
    el.style.setProperty("--c", catColor(c));
    el.onclick = () => {
      if (state.activeCats.has(c)) state.activeCats.delete(c);
      else state.activeCats.add(c);
      el.classList.toggle("on");
      el.style.background = el.classList.contains("on") ? catColor(c) : "";
      applyFilters();
    };
    chips.appendChild(el);
  });
}

function matches(l) {
  if (state.activeCats.size && !state.activeCats.has(l.category)) return false;
  if (l.warmth < state.minWarm) return false;
  if (l.brightness < state.minBright) return false;
  if (state.search) {
    const hay = [l.title, l.city, l.country, l.category, l.mood, l.best_time,
      (l.recommended_for || []).join(" "), l.lighting_notes, l.notes].join(" ").toLowerCase();
    if (!hay.includes(state.search)) return false;
  }
  return true;
}

function applyFilters() {
  state.filtered = state.all.filter(matches);
  renderList();
  renderMarkers();
  document.getElementById("count").textContent = state.filtered.length;
}

/* ---------- List ---------- */
function renderList() {
  const list = document.getElementById("list");
  list.innerHTML = "";
  if (!state.filtered.length) {
    list.innerHTML = `<p class="muted" style="padding:20px;text-align:center">No spots match. Loosen filters or + Capture a new one.</p>`;
    return;
  }
  state.filtered.forEach(l => {
    const card = document.createElement("div");
    card.className = "card" + (l.id === state.activeId ? " active" : "");
    const grad = paletteGradient(l.palette);
    const thumb = l.image
      ? `background:url('${l.image}') center/cover, ${grad}`
      : `background:${grad}`;
    const routeIdx = state.route.indexOf(l.id);
    card.innerHTML = `
      <div class="swatch" style="${thumb}"></div>
      <div>
        <h3>${escapeHtml(l.title)}</h3>
        <div class="sub"><span class="cat-dot" style="background:${catColor(l.category)}"></span>${catLabel(l.category)} · ${escapeHtml(l.city || "")}</div>
      </div>
      ${state.routeMode
        ? `<div class="route-check ${routeIdx >= 0 ? "on" : ""}">${routeIdx >= 0 ? routeIdx + 1 : ""}</div>`
        : `<div class="muted">${l.brightness ?? ""}</div>`}
    `;
    card.onclick = () => {
      if (state.routeMode) toggleRoute(l.id);
      else selectLocation(l.id, true);
    };
    list.appendChild(card);
  });
}

/* ---------- Markers ---------- */
function renderMarkers() {
  state.markers.forEach(m => map.removeLayer(m));
  state.markers.clear();
  state.filtered.forEach(l => {
    const num = state.routeMode ? (state.route.indexOf(l.id) + 1 || null) : null;
    const m = L.marker([l.lat, l.lng], { icon: pinIcon(catColor(l.category), num) });
    m.on("click", () => state.routeMode ? toggleRoute(l.id) : selectLocation(l.id, false));
    m.addTo(map);
    state.markers.set(l.id, m);
  });
}

/* ---------- Detail ---------- */
function selectLocation(id, pan) {
  state.activeId = id;
  const l = state.all.find(x => x.id === id);
  if (!l) return;
  if (pan) map.panTo([l.lat, l.lng]);
  renderDetail(l);
  renderList();
}

function metric(name, val) {
  const v = Math.max(0, Math.min(100, val ?? 0));
  return `<div class="metric">${name} <span class="muted">${Math.round(v)}</span>
    <div class="bar"><i style="width:${v}%"></i></div></div>`;
}

function renderDetail(l) {
  const d = document.getElementById("detail");
  const grad = paletteGradient(l.palette);
  const c = l.composition || {};
  const img = l.image
    ? `style="background:url('${l.image}') center/cover"`
    : `style="background:${grad}"`;
  d.className = "detail";
  d.innerHTML = `
    <div class="hero" ${img}>
      <button class="close" onclick="document.getElementById('detail').classList.add('hidden')">✕</button>
    </div>
    <div class="body">
      <span class="cat" style="background:${catColor(l.category)}">${catLabel(l.category)}</span>
      <h2>${escapeHtml(l.title)}</h2>
      <div class="muted">${escapeHtml([l.city, l.country].filter(Boolean).join(", "))}</div>
      <div class="mood">${escapeHtml(l.mood || "")}</div>

      <div class="palette-row">${(l.palette || []).map(p => `<div class="p" style="background:${p}" title="${p}"></div>`).join("")}</div>

      <div class="metrics">
        ${metric("Brightness", l.brightness)}
        ${metric("Contrast", l.contrast)}
        ${metric("Warmth", (l.warmth + 100) / 2)}
        ${metric("Depth", c.depth)}
        ${metric("Symmetry", c.symmetry)}
        ${metric("Leading lines", c.leading_lines)}
        ${metric("Rule of thirds", c.rule_of_thirds)}
        ${metric("Negative space", c.negative_space)}
      </div>

      ${kv("Best time", l.best_time)}
      ${kv("Best season", l.best_season)}
      ${l.lighting_notes ? kv("Light", l.lighting_notes) : ""}
      ${l.access_notes ? kv("Access", l.access_notes) : ""}
      ${l.notes ? kv("Notes", l.notes) : ""}
      ${(l.recommended_for && l.recommended_for.length)
        ? `<div class="kv"><b>Recommended for</b><div class="tags">${l.recommended_for.map(t => `<span>${escapeHtml(t)}</span>`).join("")}</div></div>`
        : ""}

      ${l.image_source ? `<div class="muted" style="margin-top:10px">photo: ${escapeHtml(l.image_source)}</div>` : ""}

      <div class="actions">
        <button onclick="addToRoute('${l.id}')">＋ Add to route</button>
        <button onclick="window.open('https://www.google.com/maps/dir/?api=1&destination=${l.lat},${l.lng}','_blank')">Directions</button>
        ${l.source === "user" ? `<button onclick="deleteLoc('${l.id}')">Delete</button>` : ""}
      </div>
    </div>`;
}

const kv = (b, v) => v ? `<div class="kv"><b>${b}</b>${escapeHtml(v)}</div>` : "";

/* ---------- Route planning ---------- */
function setRouteMode(on) {
  state.routeMode = on;
  document.getElementById("routeBar").classList.toggle("hidden", !on);
  document.getElementById("routeMode").textContent = on ? "exit route mode" : "route mode";
  if (!on) clearRoute();
  renderList(); renderMarkers();
}
function toggleRoute(id) {
  const i = state.route.indexOf(id);
  if (i >= 0) state.route.splice(i, 1);
  else state.route.push(id);
  updateRoute();
}
function addToRoute(id) {
  if (!state.routeMode) setRouteMode(true);
  if (!state.route.includes(id)) state.route.push(id);
  updateRoute();
}
function clearRoute() {
  state.route = [];
  if (state.routeLine) { map.removeLayer(state.routeLine); state.routeLine = null; }
  updateRoute();
}
function updateRoute() {
  document.getElementById("routeCount").textContent = state.route.length;
  renderList(); renderMarkers();
  if (state.routeLine) { map.removeLayer(state.routeLine); state.routeLine = null; }
  document.getElementById("routeStats").textContent =
    state.route.length < 2 ? "Pick 2+ stops, then plan." : `${state.route.length} stops selected`;
}

function haversine(a, b) {
  const R = 6371, toR = x => x * Math.PI / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(s));
}

function planRoute() {
  const stops = state.route.map(id => state.all.find(l => l.id === id)).filter(Boolean);
  if (stops.length < 2) return;
  // nearest-neighbor from the northern-most point, for a stable readable order
  const remaining = stops.slice();
  remaining.sort((a, b) => b.lat - a.lat);
  const order = [remaining.shift()];
  while (remaining.length) {
    const last = order[order.length - 1];
    let bi = 0, bd = Infinity;
    remaining.forEach((s, i) => { const d = haversine(last, s); if (d < bd) { bd = d; bi = i; } });
    order.push(remaining.splice(bi, 1)[0]);
  }
  state.route = order.map(s => s.id);
  let total = 0;
  for (let i = 1; i < order.length; i++) total += haversine(order[i - 1], order[i]);
  // adaptive: walking for a compact city cluster, driving once it spreads out
  const travel = total <= 6
    ? `~${Math.round(total / 5 * 60)} min on foot`
    : `~${Math.round(total / 45 * 60)} min drive`;

  if (state.routeLine) map.removeLayer(state.routeLine);
  state.routeLine = L.polyline(order.map(s => [s.lat, s.lng]), {
    color: "#4aa3c7", weight: 3, dashArray: "6 6", opacity: 0.9,
  }).addTo(map);
  map.fitBounds(state.routeLine.getBounds().pad(0.2));
  document.getElementById("routeStats").innerHTML =
    `<strong>${total.toFixed(1)} km</strong> · ${travel} · order set by proximity`;
  renderList(); renderMarkers();
}

function deleteLoc(id) {
  fetch("/api/locations/" + id, { method: "DELETE" }).then(() => {
    state.all = state.all.filter(l => l.id !== id);
    document.getElementById("detail").classList.add("hidden");
    applyFilters();
  });
}

/* ---------- Palette / image analysis (stands in for Gemini) ---------- */
function paletteGradient(pal) {
  if (!pal || !pal.length) return "#333";
  if (pal.length === 1) return pal[0];
  return `linear-gradient(135deg, ${pal.join(", ")})`;
}

function analyzeImage(img) {
  const cv = document.getElementById("canvas");
  const S = 64;
  cv.width = S; cv.height = S;
  const ctx = cv.getContext("2d");
  ctx.drawImage(img, 0, 0, S, S);
  const data = ctx.getImageData(0, 0, S, S).data;
  const buckets = {};
  let sumL = 0, sumWarm = 0, lums = [];
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    sumL += lum; lums.push(lum);
    sumWarm += (r - b);
    const key = `${r >> 5},${g >> 5},${b >> 5}`;
    if (!buckets[key]) buckets[key] = { n: 0, r: 0, g: 0, b: 0 };
    const bk = buckets[key]; bk.n++; bk.r += r; bk.g += g; bk.b += b;
  }
  const n = data.length / 4;
  const top = Object.values(buckets).sort((a, b) => b.n - a.n).slice(0, 5)
    .map(bk => rgbHex(bk.r / bk.n, bk.g / bk.n, bk.b / bk.n));
  const mean = sumL / n;
  const variance = lums.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
  return {
    palette: top,
    brightness: Math.round(mean / 255 * 100),
    contrast: Math.round(Math.min(100, Math.sqrt(variance) / 90 * 100)),
    warmth: Math.round(Math.max(-100, Math.min(100, (sumWarm / n) / 128 * 100))),
  };
}
const rgbHex = (r, g, b) => "#" + [r, g, b].map(x => Math.round(x).toString(16).padStart(2, "0")).join("");

/* ---------- EXIF GPS reader (JPEG, no libraries) ---------- */
function exifGps(buffer) {
  try {
    const dv = new DataView(buffer);
    if (dv.getUint16(0) !== 0xFFD8) return null; // not JPEG
    let off = 2;
    while (off < dv.byteLength) {
      if (dv.getUint16(off) !== 0xFFE1) { // find APP1
        const len = dv.getUint16(off + 2);
        off += 2 + len;
        continue;
      }
      const app1 = off + 4;
      if (dv.getUint32(app1) !== 0x45786966) return null; // "Exif"
      const tiff = app1 + 6;
      const little = dv.getUint16(tiff) === 0x4949;
      const g16 = (o) => dv.getUint16(o, little);
      const g32 = (o) => dv.getUint32(o, little);
      const ifd0 = tiff + g32(tiff + 4);
      const count = g16(ifd0);
      let gpsPtr = 0;
      for (let i = 0; i < count; i++) {
        const e = ifd0 + 2 + i * 12;
        if (g16(e) === 0x8825) { gpsPtr = tiff + g32(e + 8); break; }
      }
      if (!gpsPtr) return null;
      const gcount = g16(gpsPtr);
      const gps = {};
      for (let i = 0; i < gcount; i++) {
        const e = gpsPtr + 2 + i * 12;
        const tag = g16(e);
        if (tag === 1 || tag === 3) gps[tag] = String.fromCharCode(dv.getUint8(e + 8)); // ref
        if (tag === 2 || tag === 4) {
          const p = tiff + g32(e + 8);
          const rat = (o) => g32(o) / g32(o + 4);
          gps[tag] = rat(p) + rat(p + 8) / 60 + rat(p + 16) / 3600;
        }
      }
      if (gps[2] == null || gps[4] == null) return null;
      let lat = gps[2], lng = gps[4];
      if (gps[1] === "S") lat = -lat;
      if (gps[3] === "W") lng = -lng;
      return { lat, lng };
    }
  } catch (e) { return null; }
  return null;
}

/* ---------- Capture flow ---------- */
let stream = null;
function openModal() { document.getElementById("modal").classList.remove("hidden"); }
function closeModal() {
  document.getElementById("modal").classList.add("hidden");
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  ["video", "snapBtn", "preview", "metaForm"].forEach(id => document.getElementById(id).classList.add("hidden"));
  state.capture = null;
  pickingMode = false;
}

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    const v = document.getElementById("video");
    v.srcObject = stream; v.classList.remove("hidden"); await v.play();
    document.getElementById("snapBtn").classList.remove("hidden");
  } catch (e) {
    alert("Camera unavailable: " + e.message + "\nUse Upload photo instead.");
  }
}
function snap() {
  const v = document.getElementById("video");
  const cv = document.createElement("canvas");
  cv.width = v.videoWidth; cv.height = v.videoHeight;
  cv.getContext("2d").drawImage(v, 0, 0);
  const dataUrl = cv.toDataURL("image/jpeg", 0.8);
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  v.classList.add("hidden"); document.getElementById("snapBtn").classList.add("hidden");
  // camera frames rarely carry GPS -> use browser geolocation
  navigator.geolocation && navigator.geolocation.getCurrentPosition(
    p => showPreview(dataUrl, { lat: p.coords.latitude, lng: p.coords.longitude }, "device GPS"),
    () => showPreview(dataUrl, null, "no GPS — set below")
  );
  if (!navigator.geolocation) showPreview(dataUrl, null, "no GPS — set below");
}

function handleFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    const gps = exifGps(e.target.result);
    const blob = new Blob([e.target.result], { type: file.type });
    const url = URL.createObjectURL(blob);
    showPreview(url, gps, gps ? "from photo EXIF" : "no GPS in photo — set below");
  };
  reader.readAsArrayBuffer(file);
}

function showPreview(src, gps, gpsLabel) {
  const img = document.getElementById("previewImg");
  img.onload = () => {
    const a = analyzeImage(img);
    state.capture = { image: src, analysis: a, gps };
    document.getElementById("paletteRow").innerHTML =
      a.palette.map(p => `<div class="p" style="background:${p}"></div>`).join("");
    document.getElementById("metrics").innerHTML =
      metric("Brightness", a.brightness) + metric("Contrast", a.contrast) + metric("Warmth", (a.warmth + 100) / 2);
    document.getElementById("gpsInfo").textContent =
      gps ? `📍 ${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)} (${gpsLabel})` : `📍 ${gpsLabel}`;
    document.getElementById("preview").classList.remove("hidden");
    document.getElementById("metaForm").classList.remove("hidden");
    if (gps) { document.getElementById("latIn").value = gps.lat.toFixed(6); document.getElementById("lngIn").value = gps.lng.toFixed(6); }
  };
  img.src = src;
}

let pickingMode = false;
map.on("click", e => {
  if (!pickingMode) return;
  document.getElementById("latIn").value = e.latlng.lat.toFixed(6);
  document.getElementById("lngIn").value = e.latlng.lng.toFixed(6);
  pickingMode = false;
  document.getElementById("modal").classList.remove("hidden");
});

async function saveCapture() {
  const lat = parseFloat(document.getElementById("latIn").value);
  const lng = parseFloat(document.getElementById("lngIn").value);
  if (isNaN(lat) || isNaN(lng)) { alert("Set a location (pick on map or enter lat/lng)."); return; }
  const a = state.capture ? state.capture.analysis : {};
  const loc = {
    title: document.getElementById("titleIn").value || "Untitled spot",
    category: document.getElementById("catIn").value,
    lat, lng, city: "", country: "",
    palette: a.palette || ["#888"],
    brightness: a.brightness ?? 50, contrast: a.contrast ?? 50, warmth: a.warmth ?? 0,
    composition: { rule_of_thirds: 50, symmetry: 50, negative_space: 50, leading_lines: 50, depth: 50 },
    mood: "", notes: document.getElementById("notesIn").value,
    recommended_for: [], source: "user",
    image: state.capture ? state.capture.image : null,
  };
  const res = await fetch("/api/locations", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(loc),
  });
  const saved = await res.json();
  state.all.push(saved);
  closeModal();
  buildChips(); applyFilters();
  selectLocation(saved.id, true);
}

/* ---------- Wiring ---------- */
function initUI() {
  const catSel = document.getElementById("catIn");
  Object.keys(CATS).forEach(c => {
    const o = document.createElement("option"); o.value = c; o.textContent = catLabel(c); catSel.appendChild(o);
  });

  document.getElementById("search").addEventListener("input", e => { state.search = e.target.value.toLowerCase(); applyFilters(); });
  document.getElementById("fWarm").addEventListener("input", e => {
    state.minWarm = +e.target.value;
    document.getElementById("fWarmV").textContent = state.minWarm <= -100 ? "any" : `≥ ${state.minWarm}`;
    applyFilters();
  });
  document.getElementById("fBright").addEventListener("input", e => {
    state.minBright = +e.target.value;
    document.getElementById("fBrightV").textContent = state.minBright <= 0 ? "any" : `≥ ${state.minBright}`;
    applyFilters();
  });

  document.getElementById("routeMode").onclick = () => setRouteMode(!state.routeMode);
  document.getElementById("routeClear").onclick = clearRoute;
  document.getElementById("routeGo").onclick = planRoute;

  document.getElementById("addBtn").onclick = openModal;
  document.getElementById("modalClose").onclick = closeModal;
  document.getElementById("camBtn").onclick = startCamera;
  document.getElementById("snapBtn").onclick = snap;
  document.getElementById("fileInput").onchange = e => e.target.files[0] && handleFile(e.target.files[0]);
  document.getElementById("saveBtn").onclick = saveCapture;
  document.getElementById("pickBtn").onclick = () => { pickingMode = true; document.getElementById("modal").classList.add("hidden"); };
}

function escapeHtml(s) { return (s == null ? "" : String(s)).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// expose for inline handlers
window.addToRoute = addToRoute;
window.deleteLoc = deleteLoc;

initUI();
load();
