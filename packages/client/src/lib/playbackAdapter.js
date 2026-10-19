export function isDesktopEnvironment() {
  return typeof window !== "undefined" && Boolean(window.streamixDesktop?.isDesktop && window.streamixDesktop?.mpv);
}

export function createDesktopMpvAdapter() {
  const mpv = window.streamixDesktop?.mpv;
  if (!mpv) {
    throw new Error("Desktop MPV API is not available on window.streamixDesktop.mpv");
  }

  const listeners = new Map();

  const emit = (event, payload) => {
    const cbs = listeners.get(event);
    if (cbs) {
      for (const cb of cbs) {
        try {
          cb(payload);
        } catch (err) {
          console.error(`[DesktopMpvAdapter] Error in event listener for ${event}:`, err);
        }
      }
    }
  };

  const unsubscribe = mpv.onEvent((type, data) => {
    switch (type) {
      case "ready":
        emit("ready", data);
        break;
      case "time-pos":
        emit("timeupdate", Number(data));
        break;
      case "duration":
        emit("durationchange", Number(data));
        break;
      case "pause":
        if (data === true) emit("pause");
        else if (data === false) emit("play");
        break;
      case "speed":
        emit("ratechange", Number(data));
        break;
      case "volume":
        emit("volumechange", { volume: Number(data), muted: false });
        break;
      case "mute":
        emit("mutechange", Boolean(data));
        break;
      case "audio-tracks":
        emit("audiotracks", Array.isArray(data) ? data : []);
        break;
      case "subtitle-tracks":
        emit("subtitletracks", Array.isArray(data) ? data : []);
        break;
      case "aid":
        emit("audiotrackchange", data);
        break;
      case "sid":
        emit("subtitletrackchange", data);
        break;
      case "ended":
        emit("ended", data);
        break;
      case "paused-for-cache":
        emit("buffering", Boolean(data));
        break;
      case "core-idle":
        if (data === true) emit("idle");
        break;
      case "error":
        emit("error", data);
        break;
      case "hwdec-active":
        emit("hwdecactive", data);
        break;
      case "video-click":
        emit("videoclick", data);
        break;
      case "video-dblclick":
        emit("videodblclick", data);
        break;
      case "video-mousemove":
        emit("videomousemove", data);
        break;
      default:
        break;
    }
  });

  return {
    isNative: true,
    async load(sourceUrl, options = {}) {
      return await mpv.start(sourceUrl, options);
    },
    async play() {
      return await mpv.play();
    },
    async pause() {
      return await mpv.pause();
    },
    async seek(seconds) {
      return await mpv.seek(seconds, "absolute");
    },
    async setVolume(volume) {
      return await mpv.setVolume(volume);
    },
    async setMute(muted) {
      return await mpv.setMute(muted);
    },
    async setSpeed(speed) {
      return await mpv.setSpeed(speed);
    },
    async setAudioTrack(trackId) {
      return await mpv.setAudioTrack(trackId);
    },
    async setSubtitleTrack(trackId) {
      return await mpv.setSubtitleTrack(trackId);
    },
    async setBounds(bounds) {
      if (typeof mpv.setBounds === "function") {
        return await mpv.setBounds(bounds);
      }
    },
    on(event, callback) {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event).add(callback);
      return () => {
        const set = listeners.get(event);
        if (set) {
          set.delete(callback);
          if (set.size === 0) listeners.delete(event);
        }
      };
    },
    destroy() {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
      listeners.clear();
      mpv.stop().catch(() => {});
    }
  };
}
