/* updated script.js - robust & fixed
   - Works with both simple index.html (input + #weatherResult) and advanced UI
   - Fixes syntax error in getAQISummary
   - Adds global getWeather() wrapper for inline onclick usage
   - Graceful fallbacks for missing DOM nodes
   - Keeps animations, voice, share, recents (if elements present)
*/

const apiKey = "b12b01c9720e4863837131322251609"; // your provided key

// simple DOM helper
const $ = (id) => document.getElementById(id);

// Elements cache (may be null if not present)
const els = {};

// cache DOM references (safe — may be null)
function cacheEls() {
  [
    "locationInput", "searchBtn", "geoBtn", "clearHistoryBtn",
    "unitToggle", "voiceToggle", "shareBtn", "copyBtn", "openMapBtn",
    "refreshBtn", "toggleDetailsBtn", "loader", "errorBox", "weatherCard",
    "weatherIcon", "temperature", "condText", "locationName", "feelsLike",
    "humidity", "wind", "aqi", "localTime", "lastUpdated", "adviceCards",
    "detailsPanel", "detailsList", "nowcastTimeline", "recentList", "srLive",
    "recentSearches", "weatherResult"
  ].forEach(id => { els[id] = $(id); });
}

// safe text
function safeText(v){ return (v === undefined || v === null) ? "--" : String(v); }

// localStorage keys & state
const LS_KEYS = { RECENTS: "swa_recent_searches", UNIT: "swa_unit", LAST_LOC: "swa_last_location" };
const state = {
  unit: localStorage.getItem(LS_KEYS.UNIT) || "C",
  isSpeaking: false,
  lastFetched: null,
  lastLocationQuery: localStorage.getItem(LS_KEYS.LAST_LOC) || null,
  currentLatLon: null,
  recentSearches: JSON.parse(localStorage.getItem(LS_KEYS.RECENTS) || "[]"),
  inFetch: false
};

// Initialization
document.addEventListener("DOMContentLoaded", init);

function init(){
  cacheEls();
  attachListeners();
  injectAnimationStyles(); // animations for visual effects (safe to call)
  renderUnitUI();
  renderRecentSearches();
  // If advanced UI present, leave it hidden until we have data.
  if (state.lastLocationQuery) fetchWeather(state.lastLocationQuery);
  else tryAutoDetectOnLoad();
}

// Try gentle geolocation on first load
function tryAutoDetectOnLoad(){
  if (!navigator.geolocation) return;
  if (sessionStorage.getItem("swa_geo_prompted")) return;
  sessionStorage.setItem("swa_geo_prompted","1");
  navigator.geolocation.getCurrentPosition(
    pos => fetchWeather(`${pos.coords.latitude},${pos.coords.longitude}`),
    () => {},
    {timeout:4500}
  );
}

// Attach event listeners if elements exist
function attachListeners(){
  if (els.searchBtn) els.searchBtn.addEventListener("click", () => {
    const q = (els.locationInput && els.locationInput.value) ? els.locationInput.value.trim() : "";
    if (!q) return showError("Please type a city, district, area or pincode (e.g. 560001).");
    fetchWeather(q);
  });

  // support Enter key in input (if input exists)
  if (els.locationInput) {
    els.locationInput.addEventListener("keydown", (e)=> { if (e.key === "Enter") {
      if (els.searchBtn) els.searchBtn.click(); else getWeather();
    }});
  }

  if (els.geoBtn) els.geoBtn.addEventListener("click", getLocationWeather);
  if (els.clearHistoryBtn) els.clearHistoryBtn.addEventListener("click", () => {
    state.recentSearches = []; localStorage.removeItem(LS_KEYS.RECENTS); renderRecentSearches();
  });
  if (els.unitToggle) els.unitToggle.addEventListener("click", ()=> {
    state.unit = (state.unit === "C") ? "F" : "C";
    localStorage.setItem(LS_KEYS.UNIT, state.unit);
    renderUnitUI();
    if (state.lastFetched) renderWeatherToUI(state.lastFetched);
  });
  if (els.voiceToggle) els.voiceToggle.addEventListener("click", toggleVoice);
  if (els.shareBtn) els.shareBtn.addEventListener("click", shareForecast);
  if (els.copyBtn) els.copyBtn.addEventListener("click", copyForecast);
  if (els.openMapBtn) els.openMapBtn.addEventListener("click", openMap);
  if (els.refreshBtn) els.refreshBtn.addEventListener("click", ()=> {
    if (!state.lastLocationQuery) return showError("No previous location to refresh.");
    fetchWeather(state.lastLocationQuery);
  });
  if (els.toggleDetailsBtn && els.detailsPanel) {
    els.toggleDetailsBtn.addEventListener("click", ()=> {
      const expanded = els.detailsPanel.hidden;
      els.detailsPanel.hidden = !expanded;
      els.toggleDetailsBtn.setAttribute("aria-expanded", String(!expanded));
    });
  }
  if (els.recentList) {
    els.recentList.addEventListener("click", (e)=> {
      const li = e.target.closest("li[data-q]");
      if (!li) return;
      fetchWeather(li.dataset.q);
    });
  }
}

// ===== public wrapper for inline onclick in simple HTML =====
function getWeather(){
  // prefers input value; if not present, try reading simple input by id
  const input = els.locationInput || $("locationInput") || document.querySelector("input[type=search], input[type=text]");
  const q = input && input.value ? input.value.trim() : "";
  if (!q) {
    // fallback: if weatherResult exists, show friendly message there
    return showError("Please enter a location (city, district, area or pincode).");
  }
  fetchWeather(q);
}

// show loader/error helpers with fallback to simple #weatherResult
function showLoader(on=true){
  if (els.loader) els.loader.hidden = !on;
  // hide result card if advanced UI exists
  if (els.weatherCard) {
    if (on) els.weatherCard.hidden = true;
    else els.weatherCard.hidden = false;
  }
  // no advanced UI: we optionally show inline loading in #weatherResult
  if (!els.weatherCard && els.weatherResult) {
    els.weatherResult.innerHTML = on ? `<div class="simple-loader">Loading...</div>` : els.weatherResult.innerHTML;
  }
}
function showError(message){
  if (els.errorBox) { els.errorBox.hidden = false; els.errorBox.textContent = message; }
  else if (els.weatherResult) els.weatherResult.innerHTML = `<div class="error">${message}</div>`;
  else alert(message);
  if (els.srLive) els.srLive.textContent = message;
}
function clearErrorBox(){
  if (els.errorBox) { els.errorBox.hidden = true; els.errorBox.textContent = ""; }
  if (els.weatherResult && els.weatherCard) { /* keep as-is */ }
}

// recent searches helpers
function renderRecentSearches(){
  if (!els.recentList && !els.recentSearches) return;
  if (els.recentList) els.recentList.innerHTML = "";
  if (els.recentSearches) els.recentSearches.innerHTML = "";
  (state.recentSearches || []).forEach(item => {
    if (els.recentList) {
      const li = document.createElement("li");
      li.textContent = item;
      li.dataset.q = item;
      els.recentList.appendChild(li);
    }
    if (els.recentSearches) {
      const opt = document.createElement("option");
      opt.value = item;
      els.recentSearches.appendChild(opt);
    }
  });
}
function pushRecent(q){
  if (!q) return;
  state.recentSearches = state.recentSearches.filter(x => x.toLowerCase() !== q.toLowerCase());
  state.recentSearches.unshift(q);
  if (state.recentSearches.length > 8) state.recentSearches.length = 8;
  localStorage.setItem(LS_KEYS.RECENTS, JSON.stringify(state.recentSearches));
  renderRecentSearches();
}

// render unit UI
function renderUnitUI(){
  if (els.unitToggle) {
    els.unitToggle.innerText = (state.unit === "C") ? "°C / °F" : "°C / °F";
    els.unitToggle.setAttribute("aria-pressed", String(state.unit === "F"));
  }
}

// ===== core fetch =====
async function fetchWeather(locationQuery){
  if (state.inFetch) return;
  state.inFetch = true;
  showLoader(true);
  clearErrorBox();
  clearAnimations();

  try {
    const q = encodeURIComponent(locationQuery);
    const url = `https://api.weatherapi.com/v1/forecast.json?key=${apiKey}&q=${q}&days=1&aqi=yes&alerts=yes`;
    const res = await fetch(url);
    if (!res.ok) {
      const t = await res.text().catch(()=>"");
      throw new Error(`Network ${res.status} ${t}`);
    }
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || "API error");
    // persist last
    state.lastFetched = data;
    state.lastLocationQuery = locationQuery;
    localStorage.setItem(LS_KEYS.LAST_LOC, locationQuery);
    // save lat/lon
    if (data.location && data.location.lat && data.location.lon) {
      state.currentLatLon = { lat: data.location.lat, lon: data.location.lon };
    }
    pushRecent(locationQuery);
    // render (choose UI path)
    renderWeatherToUI(data);
  } catch (err) {
    console.error("fetchWeather error:", err);
    showError("Could not fetch weather. " + (err.message || ""));
  } finally {
    showLoader(false);
    state.inFetch = false;
  }
}

// ===== rendering (handles both advanced + simple UI) =====
function renderWeatherToUI(data){
  try {
    // advanced UI present?
    const advanced = !!els.weatherCard;
    if (advanced) {
      renderAdvancedUI(data);
    } else {
      renderSimpleUI(data);
    }
  } catch (err) {
    console.error("renderWeatherToUI error:", err);
    // fallback to simple display
    renderSimpleUI(data);
  }
}

// ---- Simple fallback renderer (for minimal HTML) ----
function renderSimpleUI(data){
  const target = els.weatherResult || $("weatherResult") || null;
  if (!target) {
    console.warn("No result container found (simple).");
    return;
  }
  const cur = data.current;
  const loc = data.location;
  const tempC = cur.temp_c;
  const cond = cur.condition && cur.condition.text;
  const feels = cur.feelslike_c;
  const humidity = cur.humidity;
  const wind = cur.wind_kph;
  const localtime = loc.localtime;
  // build simple markup (icon + values)
  const icon = getSimpleEmojiForCondition(cond);
  target.innerHTML = `
    <div class="result-simple" style="text-align:center; padding:12px;">
      <div style="font-size:48px; margin-bottom:6px;">${icon}</div>
      <div style="font-size:36px; font-weight:700;">${tempC}°C</div>
      <div style="font-size:18px; margin:6px 0;">${cond}</div>
      <div style="font-size:14px;color:#f2f2f2;">
        Feels: ${feels}°C · Humidity: ${humidity}% · Wind: ${wind} kph
      </div>
      <div style="font-size:13px;margin-top:8px;color:#ddd;">${loc.name}, ${loc.country} · ${localtime}</div>
    </div>
  `;
  // also set body background class if we can
  setBackgroundByCondition(cond, cur, (data.forecast && data.forecast.forecastday && data.forecast.forecastday[0] && data.forecast.forecastday[0].hour) || []);
}

// small emoji fallback mapping
function getSimpleEmojiForCondition(cond){
  if (!cond) return "🌤";
  const t = cond.toLowerCase();
  if (t.includes("rain") || t.includes("drizzle")) return "🌧️";
  if (t.includes("snow") || t.includes("sleet") || t.includes("blizzard")) return "❄️";
  if (t.includes("cloud")) return "☁️";
  if (t.includes("sun") || t.includes("clear")) return "☀️";
  if (t.includes("thunder")) return "⛈️";
  return "🌤️";
}

// ---- Advanced UI renderer (safe checks inside) ----
function renderAdvancedUI(data){
  if (!data || !data.current || !data.location) return;
  const cur = data.current;
  const loc = data.location;
  const forecastHours = (data.forecast && data.forecast.forecastday && data.forecast.forecastday[0] && data.forecast.forecastday[0].hour) || [];

  if (els.weatherCard) els.weatherCard.hidden = false;

  // temperature
  if (els.temperature) {
    const temp = (state.unit === "C") ? `${safeText(cur.temp_c)}°C` : `${safeText(cur.temp_f)}°F`;
    els.temperature.textContent = temp;
  }
  if (els.condText) els.condText.textContent = safeText(cur.condition && cur.condition.text);
  if (els.locationName) els.locationName.textContent = `${loc.name}${loc.region ? ", " + loc.region : ""}${loc.country ? " - " + loc.country : ""}`;
  if (els.feelsLike) els.feelsLike.textContent = (state.unit === "C") ? `${safeText(cur.feelslike_c)}°C` : `${safeText(cur.feelslike_f)}°F`;
  if (els.humidity) els.humidity.textContent = `${safeText(cur.humidity)}%`;
  if (els.wind) els.wind.textContent = `${safeText(cur.wind_kph)} kph`;

  const aqiSummary = getAQISummary(cur.air_quality);
  if (els.aqi) { els.aqi.textContent = aqiSummary.label; els.aqi.title = aqiSummary.detail || ""; }

  const condText = (cur.condition && cur.condition.text) ? cur.condition.text : "";
  const isDay = (cur.is_day === 1);
  if (els.weatherIcon) setWeatherIcon(condText, isDay);
  setBackgroundByCondition(condText, cur, forecastHours);

  if (els.localTime) els.localTime.textContent = `Local time: ${safeText(loc.localtime)}`;
  if (els.lastUpdated) els.lastUpdated.textContent = `Last update: ${new Date().toLocaleString()}`;

  if (els.adviceCards) els.adviceCards.innerHTML = generateAdviceCards(cur, forecastHours, loc);
  if (els.detailsList) els.detailsList.innerHTML = generateDetailsList(cur, data);
  if (els.nowcastTimeline) els.nowcastTimeline.innerHTML = generateNowcastTimeline(forecastHours, loc.localtime);

  if (els.srLive) {
    const tempStr = (state.unit === "C") ? `${cur.temp_c}°C` : `${cur.temp_f}°F`;
    els.srLive.textContent = `${loc.name}. ${condText}. ${tempStr}. Feels like ${state.unit === 'C' ? cur.feelslike_c + '°C' : cur.feelslike_f + '°F'}. Humidity ${cur.humidity} percent.`;
  }
}

// ===== utilities used by renderers =====

// Fixes and robust AQI mapping (previous bug fixed)
function getAQISummary(aqiObj){
  try {
    if (!aqiObj) return {label: "N/A", detail: ""};
    const epa = aqiObj["us-epa-index"];
    const pm25 = parseFloat(aqiObj["pm2_5"] || aqiObj.pm2_5 || 0);
    if (epa !== undefined && epa !== null) {
      const e = Number(epa);
      if (e <= 2) return {label: "Good", detail: `US EPA index ${e} (Good)`};
      if (e === 3) return {label: "Moderate", detail: `US EPA index ${e} (Moderate)`};
      if (e === 4) return {label: "Unhealthy", detail: `US EPA index ${e} (Unhealthy)`};
      if (e >= 5) return {label: "Very Unhealthy", detail: `US EPA index ${e} (Very Unhealthy)`};
    }
    if (!isNaN(pm25)) {
      if (pm25 <= 12) return {label:"Good", detail:`PM2.5 ${pm25} µg/m³`};
      if (pm25 <= 35.4) return {label:"Moderate", detail:`PM2.5 ${pm25} µg/m³`};
      if (pm25 <= 55.4) return {label:"Unhealthy for Sensitive", detail:`PM2.5 ${pm25} µg/m³`};
      return {label:"Unhealthy", detail:`PM2.5 ${pm25} µg/m³`};
    }
    return {label:"N/A", detail:""};
  } catch(e) {
    console.error("getAQISummary err", e);
    return {label:"N/A", detail:""};
  }
}

// Icon mapping (weather-icons classes) - safe even when el not present
function getWeatherIconClass(condText,isDay){
  const t = (condText || "").toLowerCase();
  if (t.includes("sun") || t.includes("clear")) return isDay ? "wi wi-day-sunny" : "wi wi-night-clear";
  if (t.includes("partly")) return isDay ? "wi wi-day-cloudy" : "wi wi-night-alt-cloudy";
  if (t.includes("cloud") || t.includes("overcast")) return "wi wi-cloudy";
  if (t.includes("rain") || t.includes("drizzle")) {
    if (t.includes("light")) return "wi wi-rain";
    if (t.includes("heavy") || t.includes("pour")) return "wi wi-showers";
    return "wi wi-rain";
  }
  if (t.includes("thunder")) return "wi wi-thunderstorm";
  if (t.includes("snow") || t.includes("sleet") || t.includes("blizzard")) return "wi wi-snow";
  if (t.includes("mist") || t.includes("fog") || t.includes("haze")) return "wi wi-fog";
  if (t.includes("wind")) return "wi wi-strong-wind";
  return "wi wi-na";
}

function setWeatherIcon(condText, isDay){
  if (!els.weatherIcon) return;
  const cls = getWeatherIconClass(condText, isDay);
  els.weatherIcon.className = cls + " big-icon";
  els.weatherIcon.style.filter = "drop-shadow(0 6px 10px rgba(0,0,0,0.25))";
}

// Background + animations: uses body classes and animation creators (safe)
function setBackgroundByCondition(condText, current, forecastHours){
  const b = document.body;
  ["sunny","cloudy","rainy","snowy"].forEach(c => b.classList.remove(c));
  const t = (condText || "").toLowerCase();
  if (t.includes("rain") || t.includes("drizzle") || t.includes("thunder")) { b.classList.add("rainy"); createRain(); }
  else if (t.includes("snow") || t.includes("sleet") || t.includes("blizzard")) { b.classList.add("snowy"); createSnow(); }
  else if (t.includes("cloud") || t.includes("overcast") || t.includes("mist") || t.includes("fog")) { b.classList.add("cloudy"); createClouds(); }
  else { b.classList.add("sunny"); }
}

// Advice, details, nowcast (same logic as before) - kept concise but robust
function generateAdviceCards(cur, forecastHours, loc){
  const adv = [];
  const tC = Number(cur.temp_c);
  const wind = Number(cur.wind_kph);
  const cond = (cur.condition && cur.condition.text || "").toLowerCase();

  if (cond.includes("rain") || cond.includes("drizzle") || cond.includes("shower") || cond.includes("thunder")) 
    adv.push({title:"Carry an umbrella", text:"Rain expected — keep an umbrella or raincoat handy.", icon:"wi wi-raindrops"});
  if (tC >= 35) adv.push({title:"Heat alert", text:"High temperature — stay hydrated & avoid strenuous outdoor work.", icon:"wi wi-hot"});
  if (tC <= 5) adv.push({title:"Cold alert", text:"Low temperature — wear warm layers and protect from frost.", icon:"wi wi-snowflake-cold"});
  if (wind >= 40) adv.push({title:"Strong winds", text:"Wind speeds are high — secure loose items and take care outdoors.", icon:"wi wi-strong-wind"});
  const aqiObj = cur.air_quality || {}; const pm25 = Number(aqiObj["pm2_5"] || 0);
  if (pm25 > 35) adv.push({title:"Air quality poor", text:"PM2.5 elevated — consider mask & avoid heavy outdoor activity.", icon:"wi wi-smoke"});
  if (adv.length === 0) adv.push({title:"Weather looks OK", text:"No major alerts — enjoy your day.", icon:"wi wi-day-sunny"});

  return adv.map(a => `
    <div class="advice-card" role="article" aria-label="${a.title}">
      <i class="${a.icon}" aria-hidden="true"></i>
      <div class="advice-body"><strong>${a.title}</strong><div class="advice-text">${a.text}</div></div>
    </div>`).join("");
}

function generateDetailsList(cur,data){
  const items = [
    {k:"Pressure", v: `${safeText(cur.pressure_mb)} mb`},
    {k:"Precipitation", v: `${safeText(cur.precip_mm)} mm`},
    {k:"UV index", v: safeText(cur.uv)},
    {k:"Visibility", v: `${safeText(cur.vis_km)} km`},
    {k:"Gust", v: `${safeText(cur.gust_kph)} kph`},
    {k:"Cloud cover", v: `${safeText(cur.cloud)}%`}
  ];
  const alerts = (data.alerts && data.alerts.alert) || [];
  if (alerts && alerts.length) items.push({k:"Alerts", v: alerts.map(a=>a.headline).join("; ")});
  return items.map(i => `<li><strong>${i.k}:</strong> ${i.v}</li>`).join("");
}

function generateNowcastTimeline(hourArray, localtimeStr){
  if (!hourArray || !hourArray.length) return `<div class="nowcast-empty">No hourly data available.</div>`;
  const nowIndex = hourArray.findIndex(h => localtimeStr && h.time.slice(0,13) === localtimeStr.slice(0,13));
  const start = (nowIndex >= 0) ? nowIndex : 0;
  const slice = hourArray.slice(start, start + 6);
  return slice.map(h => {
    const time = h.time.slice(11);
    const temp = (state.unit === "C") ? `${h.temp_c}°C` : `${h.temp_f}°F`;
    const iconClass = getWeatherIconClass(h.condition.text, h.is_day===1);
    const pop = h.chance_of_rain || h.will_it_rain ? `${h.chance_of_rain || h.will_it_rain || 0}%` : "";
    return `<div class="nowcast-tile" role="figure" aria-label="Forecast ${time}"><div class="now-time">${time}</div><i class="${iconClass}"></i><div class="now-temp">${temp}</div><div class="now-pop">${pop}</div></div>`;
  }).join("");
}

// share/copy/map/voice utilities (safe use if elements present)
function buildShareText(){
  if (!state.lastFetched) return "No forecast available.";
  const d = state.lastFetched; const cur = d.current; const loc = d.location;
  const temp = (state.unit === "C") ? `${cur.temp_c}°C` : `${cur.temp_f}°F`;
  return `${loc.name}, ${loc.region || ""} ${loc.country || ""}\n${cur.condition.text}\n${temp} (Feels ${state.unit === 'C' ? cur.feelslike_c + '°C' : cur.feelslike_f + '°F'})\nHumidity: ${cur.humidity}%\nWind: ${cur.wind_kph} kph\nLocal time: ${loc.localtime}\n— Shared from Smart Weather Assistant`;
}
async function shareForecast(){
  const text = buildShareText(); const title = "Weather forecast";
  if (navigator.share) {
    try { await navigator.share({title, text}); } catch(e) {}
  } else { await copyToClipboard(text); alert("Forecast copied to clipboard."); }
}
async function copyForecast(){ await copyToClipboard(buildShareText()); if (els.srLive) els.srLive.textContent = "Forecast copied to clipboard."; }
async function copyToClipboard(text){ try { if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text); else { const ta=document.createElement("textarea"); ta.value=text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); } } catch(e){ console.error("copy failed", e); } }
function openMap(){ if (state.currentLatLon && state.currentLatLon.lat) window.open(`https://www.google.com/maps/search/?api=1&query=${state.currentLatLon.lat},${state.currentLatLon.lon}`); else if (state.lastLocationQuery) window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(state.lastLocationQuery)}`); else showError("No location to open map."); }
function toggleVoice(){ if (!('speechSynthesis' in window)) return showError("Speech not available."); if (state.isSpeaking) { window.speechSynthesis.cancel(); state.isSpeaking=false; if (els.voiceToggle) els.voiceToggle.setAttribute("aria-pressed","false"); return; } const text = buildShareText(); const u = new SpeechSynthesisUtterance(text); u.lang = navigator.language || 'en-US'; u.rate=1; u.onend = ()=>{ state.isSpeaking=false; if (els.voiceToggle) els.voiceToggle.setAttribute("aria-pressed","false"); }; window.speechSynthesis.speak(u); state.isSpeaking=true; if (els.voiceToggle) els.voiceToggle.setAttribute("aria-pressed","true"); }

// Geolocation wrapper used by button or program
function getLocationWeather(){
  if (!navigator.geolocation) return showError("Geolocation not supported.");
  showLoader(true);
  navigator.geolocation.getCurrentPosition(pos => {
    fetchWeather(`${pos.coords.latitude},${pos.coords.longitude}`);
  }, err => { showLoader(false); showError("Location denied or unavailable."); }, {timeout:10000});
}

// ===== Animations (inject CSS + create elements) - safe =====
function injectAnimationStyles(){
  if (document.getElementById("swa-animations")) return;
  const css = `
    .weather-anim { position: fixed; pointer-events: none; z-index: 5; top:0; left:0; width:100%; height:100%; overflow:hidden; }
    .swa-raindrop { position:absolute; width:2px; height:18px; background: rgba(255,255,255,0.85); animation-name:swa-rain linear infinite; }
    @keyframes swa-rain { 0%{transform:translateY(-10vh);opacity:0}10%{opacity:1}100%{transform:translateY(110vh);opacity:0} }
    .swa-snow { position:absolute; font-size:16px; color: white; opacity:0.9; animation-name:swa-snow linear infinite; }
    @keyframes swa-snow { 0%{transform:translateY(-10vh) rotate(0deg);opacity:0}10%{opacity:1}100%{transform:translateY(110vh) rotate(360deg);opacity:0.2} }
    .swa-cloud { position:absolute; background: rgba(255,255,255,0.85); border-radius:50px; filter: blur(6px); opacity:0.9; animation: swa-cloud-move linear infinite; }
    @keyframes swa-cloud-move { from{transform:translateX(-30vw)} to{transform:translateX(120vw)} }
    .advice-card{display:flex;gap:10px;padding:10px;border-radius:8px;background:rgba(0,0,0,0.12);}
    .big-icon{font-size:64px}
    .nowcast-tile{display:inline-block;width:68px;padding:6px;margin-right:6px;background:rgba(255,255,255,0.08);border-radius:8px;text-align:center;}
  `;
  const st = document.createElement("style"); st.id="swa-animations"; st.appendChild(document.createTextNode(css)); document.head.appendChild(st);
}

function createRain(){
  removeAnimContainer();
  const wrap = document.createElement("div"); wrap.className = "weather-anim swa-rain-wrap"; document.body.appendChild(wrap);
  const count = Math.min(120, Math.floor(window.innerWidth / 8));
  for (let i=0;i<count;i++){
    const drop = document.createElement("div"); drop.className = "swa-raindrop";
    drop.style.left = `${Math.random()*100}vw`; drop.style.animationDuration = `${(0.8+Math.random()*1.2).toFixed(2)}s`;
    drop.style.animationDelay = `${(Math.random()*1.5).toFixed(2)}s`; drop.style.height = `${12+Math.random()*20}px`;
    wrap.appendChild(drop);
  }
}
function createSnow(){
  removeAnimContainer();
  const wrap = document.createElement("div"); wrap.className = "weather-anim swa-snow-wrap"; document.body.appendChild(wrap);
  const count = Math.min(60, Math.floor(window.innerWidth / 20));
  for (let i=0;i<count;i++){
    const s = document.createElement("div"); s.className = "swa-snow"; s.textContent = "❄";
    s.style.left = `${Math.random()*100}vw`; s.style.animationDuration = `${(6+Math.random()*8).toFixed(2)}s`; s.style.animationDelay = `${(Math.random()*3).toFixed(2)}s`;
    s.style.fontSize = `${10+Math.random()*18}px`; wrap.appendChild(s);
  }
}
function createClouds(){
  removeAnimContainer();
  const wrap = document.createElement("div"); wrap.className = "weather-anim swa-cloud-wrap"; document.body.appendChild(wrap);
  const count = 3 + Math.floor(window.innerWidth / 600);
  for (let i=0;i<count;i++){
    const c = document.createElement("div"); c.className = "swa-cloud";
    const width = 100 + Math.random()*300; c.style.width = `${width}px`; c.style.height = `${50 + Math.random()*60}px`;
    c.style.top = `${5 + Math.random()*45}vh`; c.style.left = `-${Math.random()*40}vw`;
    c.style.animationDuration = `${30 + Math.random()*40}s`; c.style.opacity = `${0.6 + Math.random()*0.4}`;
    wrap.appendChild(c);
  }
}
function removeAnimContainer(){ document.querySelectorAll(".weather-anim").forEach(n=>n.remove()); }
function clearAnimations(){ removeAnimContainer(); if (state.isSpeaking) { window.speechSynthesis.cancel(); state.isSpeaking=false; if (els.voiceToggle) els.voiceToggle.setAttribute("aria-pressed","false"); } }

// small helper to detect lat,lng string
function isLatLon(q){ return /^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$/.test(q); }

/* end of script */
