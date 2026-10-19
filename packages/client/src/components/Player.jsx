import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createStream, cleanupStream } from "../api.js";
import { audioTrackLabel } from "../lib/languages.js";
import {
  AUTO_QUALITY,
  applyQuality,
  buildQualityOptions,
  currentQualityValue,
  explainQuality
} from "../lib/quality.js";
import { progressStore, clampPosition } from "../lib/progress.js";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const HIDE_DELAY_MS = 3000;
const SAVE_INTERVAL_MS = 5000;

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || target.isContentEditable;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function buildEpisodeQueue(item) {
  const episodes = Array.isArray(item?.episodes) ? item.episodes : [];
  if (item?.type !== "series" || episodes.length === 0) return [];
  return episodes
    .filter((ep) => ep.season != null && ep.episode != null)
    .sort((a, b) => a.season - b.season || a.episode - b.episode);
}

export default function Player({ item, onClose, onProgress }) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const hlsRef = useRef(null);
  const sessionRef = useRef(null);
  const hideTimerRef = useRef(null);
  const saveTimerRef = useRef(0);
  const currentRef = useRef(item);
  const lastSavedRef = useRef(null);
  const savedResumeRef = useRef(null);
  const resumeAppliedRef = useRef(false);

  const [current, setCurrent] = useState(item);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState("resolving");
  const [error, setError] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [audioTracks, setAudioTracks] = useState([]);
  const [activeTrack, setActiveTrack] = useState(null);
  const [levels, setLevels] = useState([]);
  const [activeLevel, setActiveLevel] = useState(AUTO_QUALITY);
  const [preferredLang, setPreferredLang] = useState(() => localStorage.getItem("streamix.lang") || "");
  const [fullscreen, setFullscreen] = useState(false);
  const [sourceNote, setSourceNote] = useState(null);
  const [sourceStatus, setSourceStatus] = useState(null);
  const [sourceProvider, setSourceProvider] = useState(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [resumedFrom, setResumedFrom] = useState(null);
  const [ended, setEnded] = useState(false);
  const [switching, setSwitching] = useState(false);

  const queue = useMemo(() => buildEpisodeQueue(current), [current]);
  const queueIndex = useMemo(() => {
    if (queue.length === 0 || current.season == null || current.episode == null) return -1;
    return queue.findIndex((ep) => ep.season === current.season && ep.episode === current.episode);
  }, [queue, current.season, current.episode]);
  const nextEpisode = queueIndex >= 0 ? queue[queueIndex + 1] ?? null : null;

  const progressEntry = useCallback(
    (position, dur) => ({
      key: undefined,
      provider: current.provider ?? "default",
      type: current.type,
      id: current.id,
      title: current.title,
      poster: current.poster ?? null,
      backdrop: current.backdrop ?? null,
      season: current.season ?? null,
      episode: current.episode ?? null,
      episodeTitle: current.episodeTitle ?? null,
      position,
      duration: dur
    }),
    [current]
  );

  const persist = useCallback(
    (positionOverride, durationOverride) => {
      const video = videoRef.current;
      const dur = Number.isFinite(durationOverride) ? durationOverride : video?.duration;
      const pos = Number.isFinite(positionOverride) ? positionOverride : video?.currentTime;
      if (!Number.isFinite(dur) || dur <= 0 || !Number.isFinite(pos)) return;
      const entry = progressStore.save(progressEntry(pos, dur));
      lastSavedRef.current = entry;
      onProgress?.();
    },
    [progressEntry, onProgress]
  );

  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  const bumpControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      const video = videoRef.current;
      if (video && !video.paused) setControlsVisible(false);
    }, HIDE_DELAY_MS);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const playItem = current;

    async function start() {
      setPhase("resolving");
      setError(null);
      setEnded(false);
      setResumedFrom(null);
      try {
        const [stream, hlsModule] = await Promise.all([
          createStream(playItem.type, playItem.id, {
            signal: controller.signal,
            lang: preferredLang || undefined,
            provider: playItem.provider,
            season: playItem.season,
            episode: playItem.episode
          }),
          import("hls.js")
        ]);
        const Hls = hlsModule.default;
        if (cancelled) {
          cleanupStream(stream.sessionId);
          return;
        }
        sessionRef.current = stream.sessionId;
        setSourceNote(stream.note ?? null);
        setSourceStatus(stream.resolution?.status ?? null);
        setSourceProvider(stream.provider?.name ?? null);

        const video = videoRef.current;
        if (!video) return;

        // Resume handling: only for the same title/episode, never beyond the real duration.
        const saved = playItem.restart ? null : progressStore.get({
          provider: playItem.provider ?? "default",
          type: playItem.type,
          id: playItem.id,
          season: playItem.season ?? null,
          episode: playItem.episode ?? null
        });
        savedResumeRef.current = saved;
        resumeAppliedRef.current = false;

        if (!Hls.isSupported()) {
          if (video.canPlayType("application/vnd.apple.mpegurl")) {
            video.src = stream.playlistUrl;
            video.addEventListener(
              "loadedmetadata",
              () => {
                setPhase("ready");
              },
              { once: true }
            );
            return;
          }
          throw new Error("HLS playback is not supported in this browser");
        }

        const hls = new Hls({ enableWorker: true });
        hlsRef.current = hls;
        if (import.meta.env.DEV) window.__streamixHls = hls;
        hls.loadSource(stream.playlistUrl);
        hls.attachMedia(video);

        const syncAudio = (applyPreference = false) => {
          const tracks = hls.audioTracks ?? [];
          setAudioTracks(tracks);
          if (applyPreference && preferredLang) {
            const match = tracks.find((t) => t.lang === preferredLang);
            if (match) hls.audioTrack = match.id;
          }
        };
        const syncLevels = () => {
          const list = hls.levels ?? [];
          setLevels(list);
          setActiveLevel(currentQualityValue(hls));
        };

        hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => syncAudio(true));
        hls.on(Hls.Events.LEVEL_SWITCHED, () => syncLevels());
        hls.on(Hls.Events.LEVEL_LOADED, () => syncLevels());
        hls.on(Hls.Events.LEVEL_UPDATED, () => syncLevels());
        hls.on(Hls.Events.LEVELS_UPDATED, () => syncLevels());
        hls.on(Hls.Events.MANIFEST_LOADED, () => syncLevels());

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (cancelled) return;
          syncAudio(true);
          syncLevels();
          setPhase("ready");
          video.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
        });

        hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_event, data) => setActiveTrack(data.id));

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (cancelled) return;
          if (data.fatal) {
            setError(`Playback failed: ${data.details ?? data.type}`);
            setPhase("error");
            try {
              hls.destroy();
            } catch {
              // already destroyed
            }
          }
        });
      } catch (err) {
        if (cancelled || err.name === "AbortError") return;
        setError(err.message || "Failed to resolve the stream");
        setPhase("error");
      }
    }

    start();

    return () => {
      cancelled = true;
      controller.abort();
      const video = videoRef.current;
      if (video) persist(video.currentTime, video.duration);
      try {
        hlsRef.current?.destroy();
      } catch {
        // already destroyed
      }
      hlsRef.current = null;
      if (sessionRef.current) cleanupStream(sessionRef.current);
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, attempt]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    const onPlay = () => setPlaying(true);
    const onPause = () => {
      setPlaying(false);
      persist(video.currentTime, video.duration);
    };
    const onTime = () => {
      const now = video.currentTime || 0;
      setCurrentTime(now);
      try {
        if (video.buffered.length > 0) setBuffered(video.buffered.end(video.buffered.length - 1));
      } catch {
        // ignore
      }
      const stamp = Date.now();
      if (now > 0 && stamp - saveTimerRef.current > SAVE_INTERVAL_MS) {
        saveTimerRef.current = stamp;
        persist(now, video.duration);
      }
    };
    const onMeta = () => setDuration(video.duration || 0);
    // EVENT playlists only report a real duration once segments are known, so resume is
    // applied on the first durationchange with a usable value (never beyond the real length).
    const applySavedResume = () => {
      const saved = savedResumeRef.current;
      if (!saved || resumeAppliedRef.current) return;
      const dur = Number(video.duration);
      if (!Number.isFinite(dur) || dur <= 0) return;
      // EVENT playlists grow while segments load, so only resume once the reported
      // duration can actually contain the saved position (never beyond the real length).
      if (dur <= saved.position + 10) return;
      resumeAppliedRef.current = true;
      const pos = clampPosition(saved.position, dur);
      if (pos > 5 && pos < dur - 5) {
        video.currentTime = pos;
        setResumedFrom(pos);
      }
    };
    const onDuration = () => {
      setDuration(video.duration || 0);
      applySavedResume();
    };
    const onSeeked = () => persist(video.currentTime, video.duration);
    const onVolume = () => {
      setVolume(video.volume);
      setMuted(video.muted);
    };
    const onEnded = () => {
      setEnded(true);
      setPlaying(false);
      const dur = video.duration;
      if (dur > 0) {
        progressStore.save(progressEntry(dur, dur));
        onProgress?.();
      }
    };
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("progress", onTime);
    video.addEventListener("durationchange", onDuration);
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("loadeddata", applySavedResume);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("volumechange", onVolume);
    video.addEventListener("ended", onEnded);
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("progress", onTime);
      video.removeEventListener("durationchange", onDuration);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("loadeddata", applySavedResume);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("volumechange", onVolume);
      video.removeEventListener("ended", onEnded);
    };
  }, [phase, persist, progressEntry, onProgress]);

  useEffect(() => {
    const onFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => document.removeEventListener("fullscreenchange", onFullscreen);
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().then(() => setPlaying(true)).catch(() => {});
    else {
      video.pause();
      setPlaying(false);
    }
    bumpControls();
  }, [bumpControls]);

  const skip = useCallback(
    (seconds) => {
      const video = videoRef.current;
      if (!video) return;
      video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + seconds));
      bumpControls();
    },
    [bumpControls]
  );

  const seekTo = useCallback(
    (value) => {
      const video = videoRef.current;
      if (!video) return;
      video.currentTime = Number(value);
      setCurrentTime(Number(value));
      bumpControls();
    },
    [bumpControls]
  );

  const changeVolume = useCallback((value) => {
    const video = videoRef.current;
    if (!video) return;
    const v = Number(value);
    video.volume = v;
    video.muted = v === 0;
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    bumpControls();
  }, [bumpControls]);

  const changeRate = useCallback((value) => {
    const video = videoRef.current;
    const r = Number(value);
    if (video) video.playbackRate = r;
    setRate(r);
  }, []);

  const selectAudio = useCallback((id) => {
    if (!hlsRef.current) return;
    hlsRef.current.audioTrack = Number(id);
    setActiveTrack(Number(id));
  }, []);

  const selectQuality = useCallback((value) => {
    const hls = hlsRef.current;
    if (!hls) return;
    setActiveLevel(applyQuality(hls, value));
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen().catch(() => {});
    bumpControls();
  }, [bumpControls]);

  const retry = useCallback(() => {
    if (sessionRef.current) cleanupStream(sessionRef.current);
    sessionRef.current = null;
    setAttempt((n) => n + 1);
  }, []);

  const goToEpisode = useCallback(
    (ep) => {
      if (!ep) return;
      const video = videoRef.current;
      if (video) persist(video.currentTime, video.duration);
      setSwitching(true);
      setCurrent((prev) => ({
        ...prev,
        season: ep.season,
        episode: ep.episode,
        episodeTitle: ep.name ?? null,
        poster: ep.thumbnail ?? prev.poster
      }));
    },
    [persist]
  );

  useEffect(() => {
    if (switching) setSwitching(false);
  }, [current, switching]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (isEditableTarget(e.target)) return;
      const tag = e.target instanceof HTMLElement ? e.target.tagName : "";
      if ((e.code === "Space" || e.key.toLowerCase() === "k") && tag !== "BUTTON") {
        e.preventDefault();
        togglePlay();
      }
      if (e.key === "ArrowLeft") skip(-10);
      if (e.key === "ArrowRight") skip(10);
      if (e.key.toLowerCase() === "m") toggleMute();
      if (e.key.toLowerCase() === "f") toggleFullscreen();
      bumpControls();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, togglePlay, skip, toggleMute, toggleFullscreen, bumpControls]);

  useEffect(() => {
    bumpControls();
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [bumpControls]);

  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const bufferedPct = duration > 0 ? Math.min(100, (buffered / duration) * 100) : 0;
  const qualityInfo = buildQualityOptions(levels, activeLevel);
  const qualityNote = explainQuality(qualityInfo.realCount, qualityInfo.displayLabel);
  const qualityLabel =
    qualityInfo.single
      ? qualityInfo.displayLabel
      : activeLevel === AUTO_QUALITY
        ? "Auto"
        : (qualityInfo.real.find((level) => level.value === activeLevel)?.label ?? "Auto");
  const displayTitle =
    current.type === "series" && current.season != null && current.episode != null
      ? `${current.title} — S${current.season}E${current.episode}${current.episodeTitle ? ` · ${current.episodeTitle}` : ""}`
      : current.title;

  return (
    <div
      className={`player ${controlsVisible ? "controls-visible" : "controls-hidden"}`}
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Playing ${displayTitle}`}
      onMouseMove={bumpControls}
      onTouchStart={bumpControls}
    >
      <video ref={videoRef} className="player-video" playsInline onClick={togglePlay} onDoubleClick={toggleFullscreen} />

      {(phase === "resolving" || switching) && (
        <div className="player-center">
          <div className="player-spinner" role="status" aria-label="Loading stream" />
          <p className="player-center-text">Resolving stream and preparing HLS...</p>
        </div>
      )}

      {phase === "error" && (
        <div className="player-center">
          <div className="player-error-panel" role="alert">
            <h2>Playback error</h2>
            <p>{error}</p>
            <div className="player-error-actions">
              <button type="button" className="player-btn player-btn-primary" onClick={retry}>
                Retry
              </button>
              <button type="button" className="player-btn" onClick={onClose}>
                Back
              </button>
            </div>
          </div>
        </div>
      )}

      {(phase === "ready" || controlsVisible) && (
        <>
          <div className="player-top" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="player-btn player-back" onClick={onClose} aria-label="Back to details">
              ‹ Back
            </button>
            <span className="player-title" title={displayTitle}>
              {displayTitle}
            </span>
            {sourceStatus === "fixture_fallback" && <span className="player-test-badge">TEST MODE</span>}
            {sourceStatus === "provider_stream" && (
              <span className="player-live-badge">{sourceProvider ? `Real source · ${sourceProvider}` : "Real source"}</span>
            )}
            {sourceNote && (
              <span className="player-source" title={sourceNote}>
                {sourceNote}
              </span>
            )}
          </div>

          {phase === "ready" && !playing && !ended && (
            <button type="button" className="player-big-play" onClick={togglePlay} aria-label="Play">
              <span className="player-big-play-icon" aria-hidden="true">
                ▶
              </span>
            </button>
          )}

          {phase === "ready" && (ended || resumedFrom) && (
            <div className="player-toast" role="status">
              {ended ? "Finished" : `Resumed from ${formatTime(resumedFrom)}`}
            </div>
          )}

          {ended && nextEpisode && (
            <div className="player-next-panel">
              <p>Up next: S{nextEpisode.season}E{nextEpisode.episode} {nextEpisode.name ? `· ${nextEpisode.name}` : ""}</p>
              <div className="player-error-actions">
                <button type="button" className="player-btn player-btn-primary" onClick={() => goToEpisode(nextEpisode)}>
                  Play Next
                </button>
                <button type="button" className="player-btn" onClick={() => setEnded(false)}>
                  Replay
                </button>
              </div>
            </div>
          )}

          <div className="player-bottom" onClick={(e) => e.stopPropagation()}>
            <div className="player-timeline">
              <input
                type="range"
                className="player-seek"
                min="0"
                max={duration || 0}
                step="0.1"
                value={Math.min(currentTime, duration || 0)}
                onChange={(e) => seekTo(e.target.value)}
                aria-label="Seek"
                style={{ "--played": `${progress}%`, "--buffered": `${bufferedPct}%` }}
              />
              <div className="player-time">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            <div className="player-controls">
              <button type="button" className="player-btn" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
                {playing ? "❚❚" : "▶"}
              </button>
              <button type="button" className="player-btn" onClick={() => skip(-10)} aria-label="Seek back 10 seconds">
                ⟲ 10
              </button>
              <button type="button" className="player-btn" onClick={() => skip(10)} aria-label="Seek forward 10 seconds">
                10 ⟳
              </button>

              <div className="player-volume">
                <button type="button" className="player-btn" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
                  {muted || volume === 0 ? "🔇" : "🔊"}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={muted ? 0 : volume}
                  onChange={(e) => changeVolume(e.target.value)}
                  aria-label="Volume"
                  style={{ "--played": `${(muted ? 0 : volume) * 100}%` }}
                />
              </div>

              <div className="player-spacer" />

              {audioTracks.length > 0 && (
                <label className="player-select">
                  <span>Audio</span>
                  <select
                    value={activeTrack ?? audioTracks[0]?.id ?? ""}
                    onChange={(e) => selectAudio(e.target.value)}
                    aria-label="Audio track"
                  >
                    {audioTracks.map((track) => (
                      <option key={track.id} value={track.id}>
                        {audioTrackLabel(track)}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {qualityInfo.single ? (
                <span className="player-quality-static" title={qualityNote ?? "Single quality source"}>
                  <span className="player-quality-label">Quality</span>
                  <span className="player-quality-value">{qualityLabel}</span>
                </span>
              ) : (
                <label className="player-select" title={qualityNote ?? "Choose video quality"}>
                  <span>Quality</span>
                  <select
                    value={activeLevel}
                    onChange={(e) => selectQuality(e.target.value)}
                    aria-label="Video quality"
                  >
                    {qualityInfo.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.value === AUTO_QUALITY ? "Auto" : option.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="player-select">
                <span>Speed</span>
                <select value={rate} onChange={(e) => changeRate(e.target.value)} aria-label="Playback speed">
                  {SPEEDS.map((s) => (
                    <option key={s} value={s}>
                      {s}×
                    </option>
                  ))}
                </select>
              </label>

              {current.type === "series" && nextEpisode && (
                <button
                  type="button"
                  className="player-btn"
                  onClick={() => goToEpisode(nextEpisode)}
                  aria-label={`Play next episode S${nextEpisode.season}E${nextEpisode.episode}`}
                >
                  Next ⏭
                </button>
              )}

              <button
                type="button"
                className="player-btn"
                onClick={toggleFullscreen}
                aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              >
                {fullscreen ? "⤢ Exit" : "⤢ Full"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
