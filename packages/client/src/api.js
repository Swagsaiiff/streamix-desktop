const HOME_ROWS = ["trending", "popular-movies", "new-releases", "top-rated", "action", "comedy", "horror", "popular-series", "action-series", "anime-airing", "anime-trending"];

async function request(path, options = {}) {
  const base = typeof window !== "undefined" && window.streamixDesktop?.apiUrl
    ? window.streamixDesktop.apiUrl.replace(/\/+$/, "")
    : "";
  const fullUrl = path.startsWith("http") ? path : `${base}${path}`;
  const res = await fetch(fullUrl, options);
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.message || `Request failed with status ${res.status}`);
  }
  return body;
}

export async function fetchHomeSections() {
  try {
    const data = await request("/api/home");
    return data.rows.map((row) => ({ key: row.key, data: row }));
  } catch (err) {
    const results = await Promise.allSettled(
      HOME_ROWS.map((key) =>
        request(`/api/home/${key}`).then((data) => {
          const row = Array.isArray(data.rows) ? data.rows[0] : data;
          return { key, data: { ...row, key } };
        })
      )
    );
    const ok = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
    if (ok.length === 0) {
      throw err;
    }
    return ok;
  }
}

export function fetchSearch(q, options = {}) {
  return request(`/api/search?q=${encodeURIComponent(q)}`, options);
}

export function fetchDetail(type, id, { provider, ...options } = {}) {
  const query = provider ? `?provider=${encodeURIComponent(provider)}` : "";
  return request(`/api/detail/${type}/${encodeURIComponent(id)}${query}`, options);
}

export function createStream(type, id, { lang, provider, season, episode, mode, ...options } = {}) {
  const base = `/api/stream/${type}/${encodeURIComponent(id)}`;
  const params = new URLSearchParams();
  if (lang) params.set("lang", lang);
  if (provider) params.set("provider", provider);
  if (season != null) params.set("season", String(season));
  if (episode != null) params.set("episode", String(episode));
  if (mode) params.set("mode", mode);
  const query = params.toString();
  const path = query ? `${base}?${query}` : base;
  return request(path, { method: "POST", ...options });
}

export function createLazyHlsSession(ticket) {
  return request("/api/stream/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket })
  });
}

export function cleanupStream(sessionId) {
  if (!sessionId) return Promise.resolve(null);
  return request(`/api/stream/${encodeURIComponent(sessionId)}`, { method: "DELETE" }).catch(() => null);
}

export function fetchSearchSuggestions(q, options = {}) {
  return request(`/api/search/suggestions?q=${encodeURIComponent(q)}`, options);
}

export function fetchRepository() {
  return request("/api/extensions/repository");
}

export function setRepository(url) {
  return request("/api/extensions/repository", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url })
  });
}

export function removeRepository() {
  return request("/api/extensions/repository", { method: "DELETE" });
}

export function fetchCatalog(refresh = false) {
  return request(`/api/extensions/catalog${refresh ? "?refresh=true" : ""}`);
}

export function fetchInstalledExtensions() {
  return request("/api/extensions/installed");
}

export function installExtension(id) {
  return request("/api/extensions/install", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ providerId: id, id })
  });
}

export function uninstallExtension(id) {
  return request("/api/extensions/uninstall", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ providerId: id, id })
  });
}

export function toggleExtension(id, enabled) {
  return request("/api/extensions/toggle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ providerId: id, id, enabled })
  });
}

export function toggleAllExtensions(enabled) {
  return request("/api/extensions/toggle-all", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled })
  });
}

export function fetchLogs(params = {}) {
  const q = new URLSearchParams();
  if (params.level) q.set("level", params.level);
  if (params.search) q.set("search", params.search);
  if (params.sinceId) q.set("sinceId", String(params.sinceId));
  if (params.limit) q.set("limit", String(params.limit));
  const qs = q.toString();
  return request(`/api/extensions/logs${qs ? `?${qs}` : ""}`);
}

export function clearLogs() {
  return request("/api/extensions/logs/clear", { method: "POST" });
}

export function postClientLog(entry) {
  return request("/api/extensions/logs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry)
  }).catch(() => null);
}

