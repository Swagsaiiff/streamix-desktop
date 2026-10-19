const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const configured = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function write(level, msg, context = {}) {
  if (LEVELS[level] < configured) return;
  const line = JSON.stringify({ level, ts: new Date().toISOString(), msg, ...context });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (msg, context) => write("debug", msg, context),
  info: (msg, context) => write("info", msg, context),
  warn: (msg, context) => write("warn", msg, context),
  error: (msg, context) => write("error", msg, context)
};