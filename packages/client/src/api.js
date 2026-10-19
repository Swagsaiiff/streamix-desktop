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
