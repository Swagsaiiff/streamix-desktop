const port = process.env.PORT || 4000;
const url = `http://localhost:${port}/api/health`;

try {
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok || body.ok !== true) {
    throw new Error(`unexpected response ${res.status}: ${JSON.stringify(body)}`);
  }
  console.log(`HEALTH OK ${url} -> ${JSON.stringify(body)}`);
} catch (err) {
  console.error(`HEALTH FAIL ${url} -> ${err.message}`);
  process.exit(1);
}
