import { useState, useEffect, useRef, useCallback } from "react";
import {
  fetchRepository,
  setRepository,
  removeRepository,
  fetchCatalog,
  fetchInstalledExtensions,
  installExtension,
  uninstallExtension,
  toggleExtension,
  toggleAllExtensions,
  fetchLogs,
  clearLogs
} from "../api.js";

const DEFAULT_REPO_URL =
  "https://raw.githubusercontent.com/Swagsaiiff/streamix-extension-lab/main/repository/repository.json";

export default function Settings() {
  // Repository state
  const [repoUrl, setRepoUrl] = useState(DEFAULT_REPO_URL);
  const [repoInfo, setRepoInfo] = useState(null);
  const [repoLoading, setRepoLoading] = useState(false);
  const [repoError, setRepoError] = useState(null);

  // Providers state
  const [catalog, setCatalog] = useState([]);
  const [installed, setInstalled] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [providerSearch, setProviderSearch] = useState("");
  const [actionInProgress, setActionInProgress] = useState({});
  const [actionError, setActionError] = useState(null);

  // Live Logs state
  const [logsExpanded, setLogsExpanded] = useState(true);
  const [logs, setLogs] = useState([]);
  const [logLevel, setLogLevel] = useState("ALL");
  const [logSearch, setLogSearch] = useState("");
  const [isPaused, setIsPaused] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const pollTimerRef = useRef(null);
  const logContainerRef = useRef(null);

  // Load repository and installed providers on mount
  const refreshAll = useCallback(async () => {
    try {
      setRepoLoading(true);
      const [repoData, installedData] = await Promise.all([
        fetchRepository().catch(() => null),
        fetchInstalledExtensions().catch(() => ({ installed: [] }))
      ]);

      if (repoData && repoData.repository) {
        setRepoInfo(repoData.repository);
        if (repoData.repository.url) {
          setRepoUrl(repoData.repository.url);
        }
      }
      setInstalled(installedData?.installed || []);

      // If repository is connected, fetch catalog
      if (repoData?.repository?.connected) {
        setCatalogLoading(true);
        const catData = await fetchCatalog().catch(() => ({ catalog: [] }));
        setCatalog(catData?.catalog || []);
        setCatalogLoading(false);
      }
      setRepoError(null);
    } catch (err) {
      setRepoError(err.message);
    } finally {
      setRepoLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // Handle repository connect
  const handleConnectRepo = async (e) => {
    e?.preventDefault();
    if (!repoUrl.trim()) return;
    setRepoLoading(true);
    setRepoError(null);
    try {
      const res = await setRepository(repoUrl.trim());
      setRepoInfo(res.repository);
      setCatalog(res.catalog || []);
    } catch (err) {
      setRepoError(err.message);
    } finally {
      setRepoLoading(false);
    }
  };

  // Handle refresh catalog
  const handleRefreshRepo = async () => {
    setCatalogLoading(true);
    setRepoError(null);
    try {
      const catData = await fetchCatalog(true);
      setCatalog(catData?.catalog || []);
      const installedData = await fetchInstalledExtensions();
      setInstalled(installedData?.installed || []);
    } catch (err) {
      setRepoError(err.message);
    } finally {
      setCatalogLoading(false);
    }
  };

  // Handle remove repository
  const handleRemoveRepo = async () => {
    if (!confirm("Are you sure you want to disconnect this extension repository?")) return;
    setRepoLoading(true);
    try {
      await removeRepository();
      setRepoInfo(null);
      setCatalog([]);
    } catch (err) {
      setRepoError(err.message);
    } finally {
      setRepoLoading(false);
    }
  };

  // Install extension
  const handleInstall = async (providerId) => {
    setActionInProgress((prev) => ({ ...prev, [providerId]: "installing" }));
    setActionError(null);
    try {
      await installExtension(providerId);
      const [installedData, catData] = await Promise.all([
        fetchInstalledExtensions(),
        fetchCatalog()
      ]);
      setInstalled(installedData?.installed || []);
      setCatalog(catData?.catalog || []);
    } catch (err) {
      setActionError(`Installation failed for ${providerId}: ${err.message}`);
    } finally {
      setActionInProgress((prev) => ({ ...prev, [providerId]: null }));
    }
  };

  // Uninstall extension
  const handleUninstall = async (providerId) => {
    if (!confirm(`Are you sure you want to uninstall this provider?`)) return;
    setActionInProgress((prev) => ({ ...prev, [providerId]: "uninstalling" }));
    setActionError(null);
    try {
      await uninstallExtension(providerId);
      const [installedData, catData] = await Promise.all([
        fetchInstalledExtensions(),
        fetchCatalog()
      ]);
      setInstalled(installedData?.installed || []);
      setCatalog(catData?.catalog || []);
    } catch (err) {
      setActionError(`Uninstall failed for ${providerId}: ${err.message}`);
    } finally {
      setActionInProgress((prev) => ({ ...prev, [providerId]: null }));
    }
  };

  // Toggle single extension
  const handleToggle = async (providerId, currentEnabled) => {
    setActionInProgress((prev) => ({ ...prev, [providerId]: "toggling" }));
    try {
      await toggleExtension(providerId, !currentEnabled);
      const installedData = await fetchInstalledExtensions();
      setInstalled(installedData?.installed || []);
    } catch (err) {
      setActionError(`Toggle failed for ${providerId}: ${err.message}`);
    } finally {
      setActionInProgress((prev) => ({ ...prev, [providerId]: null }));
    }
  };

  // Enable All / Disable All
  const handleToggleAll = async (enabled) => {
    setActionInProgress((prev) => ({ ...prev, all: true }));
    try {
      await toggleAllExtensions(enabled);
      const installedData = await fetchInstalledExtensions();
      setInstalled(installedData?.installed || []);
    } catch (err) {
      setActionError(`Batch toggle failed: ${err.message}`);
    } finally {
      setActionInProgress((prev) => ({ ...prev, all: false }));
    }
  };

  // Live Logs Polling
  const pollLogs = useCallback(async () => {
    if (isPaused) return;
    try {
      const data = await fetchLogs({
        level: logLevel !== "ALL" ? logLevel : undefined,
        search: logSearch.trim() || undefined,
        limit: 150
      });
      if (Array.isArray(data.logs)) {
        setLogs(data.logs);
      }
    } catch {
      // Ignore network errors in logs polling
    }
  }, [isPaused, logLevel, logSearch]);

  useEffect(() => {
    pollLogs();
    pollTimerRef.current = setInterval(pollLogs, 2500);
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [pollLogs]);

  // Clear Logs
  const handleClearLogs = async () => {
    try {
      await clearLogs();
      setLogs([]);
    } catch (err) {
      setActionError(`Failed to clear logs: ${err.message}`);
    }
  };

  // Copy Logs
  const handleCopyLogs = () => {
    const text = logs
      .map((l) => `[${l.timestamp}] [${l.level}] [${l.component}] [${l.stage}] ${l.message}`)
      .join("\n");
    navigator.clipboard.writeText(text);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
  };

  // Export / Download Logs
  const handleExportLogs = () => {
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `streamix-diagnostics-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredCatalog = catalog.filter((p) => {
    if (!providerSearch.trim()) return true;
    const term = providerSearch.toLowerCase();
    return (
      p.displayName?.toLowerCase().includes(term) ||
      p.id?.toLowerCase().includes(term) ||
      p.description?.toLowerCase().includes(term)
    );
  });

  return (
    <div className="settings-container">
      <div className="settings-header">
        <h1 className="settings-title">Settings</h1>
        <p className="settings-subtitle">Manage extension repositories, provider modules, and runtime diagnostics</p>
      </div>

      {actionError && (
        <div className="settings-alert alert-error" role="alert">
          <span>{actionError}</span>
          <button className="alert-close-btn" onClick={() => setActionError(null)}>×</button>
        </div>
      )}

      {/* 1. EXTENSION REPOSITORY CONFIGURATION */}
      <section className="settings-card">
        <div className="card-header">
          <div>
            <h2 className="card-title">Extension Repository</h2>
            <p className="card-desc">Discover and install provider extensions from a centralized Streamix repository</p>
          </div>
          {repoInfo?.connected && (
            <span className="badge badge-success">Connected</span>
          )}
        </div>

        <form className="repo-form" onSubmit={handleConnectRepo}>
          <div className="repo-input-wrapper">
            <input
              type="url"
              className="settings-input"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://.../repository.json"
              required
              disabled={repoLoading}
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={repoLoading || !repoUrl.trim()}
            >
              {repoLoading ? "Connecting..." : "Connect Repository"}
            </button>
            {repoInfo?.connected && (
              <>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleRefreshRepo}
                  disabled={catalogLoading}
                  title="Refresh catalog from repository"
                >
                  {catalogLoading ? "Refreshing..." : "Refresh"}
                </button>
                <button
                  type="button"
                  className="btn btn-danger-outline"
                  onClick={handleRemoveRepo}
                  disabled={repoLoading}
                  title="Disconnect repository"
                >
                  Remove
                </button>
              </>
            )}
          </div>
        </form>

        {repoError && (
          <div className="repo-error-banner">
            <strong>Connection Error:</strong> {repoError}
          </div>
        )}

        {repoInfo?.connected && (
          <div className="repo-meta-summary">
            <div className="meta-item">
              <span className="meta-label">Repository Name:</span>
              <span className="meta-value">{repoInfo.name || "Streamix Extension Lab"}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Repository ID:</span>
              <span className="meta-value">{repoInfo.id || "streamix-extension-lab"}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Available Providers:</span>
              <span className="meta-value">{catalog.length}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Manifest URL:</span>
              <span className="meta-value text-truncate" title={repoInfo.url}>{repoInfo.url}</span>
            </div>
          </div>
        )}
      </section>

      {/* 2. INSTALLED PROVIDERS SECTION */}
      <section className="settings-card">
        <div className="card-header">
          <div>
            <h2 className="card-title">Installed Providers ({installed.length})</h2>
            <p className="card-desc">Enabled providers are queried automatically when resolving streaming sources</p>
          </div>
          {installed.length > 0 && (
            <div className="card-actions">
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => handleToggleAll(true)}
                disabled={actionInProgress.all}
              >
                Enable All
              </button>
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => handleToggleAll(false)}
                disabled={actionInProgress.all}
              >
                Disable All
              </button>
            </div>
          )}
        </div>

        {installed.length === 0 ? (
          <div className="empty-catalog-box">
            <p>No extensions installed yet.</p>
            <p className="empty-subtext">Install providers from the Available Catalog below to begin streaming.</p>
          </div>
        ) : (
          <div className="provider-grid">
            {installed.map((item) => {
              const isWorking = actionInProgress[item.id];
              return (
                <div key={item.id} className={`provider-card ${item.enabled ? "is-enabled" : "is-disabled"}`}>
                  <div className="provider-card-main">
                    <div className="provider-title-row">
                      <h3 className="provider-name">{item.displayName}</h3>
                      <span className="provider-version">v{item.version}</span>
                    </div>
                    <span className="provider-id">{item.id}</span>
                    <p className="provider-desc">{item.description || "Streamix provider extension"}</p>

                    <div className="provider-tags">
                      {Array.isArray(item.languages) &&
                        item.languages.map((l) => (
                          <span key={l} className="tag tag-lang">{l.toUpperCase()}</span>
                        ))}
                      {Array.isArray(item.contentTypes) &&
                        item.contentTypes.map((c) => (
                          <span key={c} className="tag tag-type">{c}</span>
                        ))}
                    </div>

                    {item.initializationError && (
                      <div className="provider-init-error">
                        <strong>Initialization Error:</strong> {item.initializationError}
                      </div>
                    )}
                  </div>

                  <div className="provider-card-footer">
                    <div className="status-indicator-group">
                      <span className={`status-dot ${item.enabled ? "dot-active" : "dot-inactive"}`} />
                      <span className="status-text">
                        {item.initializationError ? "Failed" : item.enabled ? "Operational" : "Disabled"}
                      </span>
                    </div>

                    <div className="provider-ctrls">
                      <label className="switch-toggle" title={item.enabled ? "Disable provider" : "Enable provider"}>
                        <input
                          type="checkbox"
                          checked={Boolean(item.enabled)}
                          disabled={Boolean(isWorking)}
                          onChange={() => handleToggle(item.id, item.enabled)}
                        />
                        <span className="slider round"></span>
                      </label>
                      <button
                        className="btn-icon-danger"
                        onClick={() => handleUninstall(item.id)}
                        disabled={Boolean(isWorking)}
                        title="Uninstall provider"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 3. AVAILABLE PROVIDER CATALOG */}
      <section className="settings-card">
        <div className="card-header">
          <div>
            <h2 className="card-title">Available Providers Catalog</h2>
            <p className="card-desc">Providers discovered from the connected repository</p>
          </div>
          <div className="search-filter-wrapper">
            <input
              type="text"
              className="settings-input input-sm"
              placeholder="Filter providers..."
              value={providerSearch}
              onChange={(e) => setProviderSearch(e.target.value)}
            />
          </div>
        </div>

        {catalogLoading ? (
          <div className="catalog-loading-box">
            <div className="spinner"></div>
            <span>Fetching provider catalog...</span>
          </div>
        ) : filteredCatalog.length === 0 ? (
          <div className="empty-catalog-box">
            <p>{repoInfo?.connected ? "No matching providers found." : "Connect a repository above to browse available providers."}</p>
          </div>
        ) : (
          <div className="provider-grid">
            {filteredCatalog.map((entry) => {
              const isInstalled = Boolean(entry.isInstalled) || installed.some((i) => i.id === entry.id && i.status !== "FAILED");
              const isFailed = Boolean(entry.isFailed) || installed.some((i) => i.id === entry.id && i.status === "FAILED");
              const isWorking = actionInProgress[entry.id] === "installing";

              return (
                <div key={entry.id} className="provider-card catalog-card">
                  <div className="provider-card-main">
                    <div className="provider-title-row">
                      <h3 className="provider-name">{entry.displayName}</h3>
                      <span className="provider-version">v{entry.version}</span>
                    </div>
                    <span className="provider-id">{entry.id}</span>
                    <p className="provider-desc">{entry.description || "Streamix extension"}</p>

                    <div className="provider-tags">
                      {Array.isArray(entry.languages) &&
                        entry.languages.map((l) => (
                          <span key={l} className="tag tag-lang">{l.toUpperCase()}</span>
                        ))}
                      {Array.isArray(entry.contentTypes) &&
                        entry.contentTypes.map((c) => (
                          <span key={c} className="tag tag-type">{c}</span>
                        ))}
                    </div>
                  </div>

                  <div className="provider-card-footer">
                    {isInstalled ? (
                      <span className="badge badge-installed">✓ Installed</span>
                    ) : (
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => handleInstall(entry.id)}
                        disabled={isWorking}
                      >
                        {isWorking ? "Installing & Verifying..." : isFailed ? "Retry Install" : "Install"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 4. RUNTIME DIAGNOSTICS & LIVE LOGS */}
      <section className="settings-card diagnostics-card">
        <div
          className="card-header clickable-header"
          onClick={() => setLogsExpanded(!logsExpanded)}
        >
          <div className="diagnostics-title-group">
            <span className={`live-pulse-dot ${isPaused ? "dot-paused" : "dot-live"}`} />
            <h2 className="card-title">Runtime Diagnostics / Live Logs</h2>
            <span className="badge badge-dim">{logs.length} events</span>
          </div>
          <button
            type="button"
            className="btn-toggle-icon"
            aria-label="Toggle diagnostics section"
          >
            {logsExpanded ? "▼ Collapse" : "▲ Expand"}
          </button>
        </div>

        {logsExpanded && (
          <div className="diagnostics-body">
            <div className="diagnostics-toolbar">
              <div className="log-level-filters">
                {["ALL", "INFO", "WARN", "ERROR", "DEBUG"].map((lvl) => (
                  <button
                    key={lvl}
                    className={`btn-filter ${logLevel === lvl ? "active" : ""}`}
                    onClick={() => setLogLevel(lvl)}
                  >
                    {lvl}
                  </button>
                ))}
              </div>

              <div className="diagnostics-search-box">
                <input
                  type="text"
                  className="settings-input input-sm"
                  placeholder="Filter logs by keyword..."
                  value={logSearch}
                  onChange={(e) => setLogSearch(e.target.value)}
                />
              </div>

              <div className="diagnostics-actions">
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => setIsPaused(!isPaused)}
                  title={isPaused ? "Resume live streaming" : "Pause live streaming"}
                >
                  {isPaused ? "▶ Resume" : "⏸ Pause"}
                </button>
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={handleCopyLogs}
                  title="Copy logs to clipboard"
                >
                  {copyFeedback ? "✓ Copied" : "Copy"}
                </button>
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={handleExportLogs}
                  title="Download logs as JSON"
                >
                  Export
                </button>
                <button
                  className="btn btn-sm btn-danger-outline"
                  onClick={handleClearLogs}
                  title="Clear in-memory logs"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="log-viewer" ref={logContainerRef}>
              {logs.length === 0 ? (
                <div className="log-empty-state">No runtime log events match the current filter.</div>
              ) : (
                <div className="log-table">
                  <div className="log-table-head">
                    <span className="col-time">Time</span>
                    <span className="col-level">Level</span>
                    <span className="col-comp">Component</span>
                    <span className="col-stage">Stage</span>
                    <span className="col-msg">Diagnostic Message</span>
                  </div>
                  <div className="log-table-body">
                    {logs.map((entry) => (
                      <div key={entry.id} className={`log-row log-${entry.level.toLowerCase()}`}>
                        <span className="col-time" title={entry.timestamp}>
                          {entry.timestamp ? entry.timestamp.split("T")[1]?.replace("Z", "") : ""}
                        </span>
                        <span className={`col-level badge-lvl lvl-${entry.level.toLowerCase()}`}>
                          {entry.level}
                        </span>
                        <span className="col-comp">{entry.component}</span>
                        <span className="col-stage">{entry.stage}</span>
                        <span className="col-msg" title={entry.message}>
                          {entry.message}
                          {entry.meta && (
                            <span className="log-meta-inline"> {JSON.stringify(entry.meta)}</span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
