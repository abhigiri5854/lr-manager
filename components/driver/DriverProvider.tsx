"use client";

// Driver app state shared by every /d screen: language, saved company links, location permission and
// position, and the offline queue of status taps.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { TripEvent, TripEventType } from "@/lib/types";
import { isRetryable, NetworkError, postEvent, postPing } from "@/lib/driver-app/api";
import { translate, type Key, type Lang } from "@/lib/driver-app/i18n";
import {
  loadLang,
  loadLinks,
  loadQueue,
  locationAsked,
  markLocationAsked,
  saveLang,
  saveLinks,
  saveQueue,
  upsertLink,
  type Pos,
  type QueuedEvent,
  type SavedLink,
} from "@/lib/driver-app/storage";

export type Perm = "unknown" | "prompt" | "granted" | "denied";

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: Key, vars?: Record<string, string | number>) => string;
  hydrated: boolean;
  links: SavedLink[];
  saveLink: (info: { token: string; companyName: string; driverName: string; officePhone: string | null }) => void;
  /** Removes a saved link; `announce` shows "<company> closed the link" once. */
  dropLink: (token: string, announce: boolean) => SavedLink | undefined;
  notices: Array<{ id: string; company: string }>;
  dismissNotice: (id: string) => void;
  perm: Perm;
  gpsUnavailable: boolean;
  requestLocation: () => Promise<void>;
  queue: QueuedEvent[];
  /** Bumps when queued taps were delivered, so screens reload their trips. */
  syncVersion: number;
  sendEvent: (token: string, challanId: string, type: TripEventType) => Promise<{ queued: boolean; event?: TripEvent }>;
};

const DriverContext = createContext<Ctx | null>(null);

export function useDriver(): Ctx {
  const ctx = useContext(DriverContext);
  if (!ctx) throw new Error("useDriver outside DriverProvider");
  return ctx;
}

const FRESH_MS = 2 * 60_000;

export function DriverProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("hi");
  const [hydrated, setHydrated] = useState(false);
  const [links, setLinks] = useState<SavedLink[]>([]);
  const [notices, setNotices] = useState<Array<{ id: string; company: string }>>([]);
  const [perm, setPerm] = useState<Perm>("unknown");
  const [gpsUnavailable, setGpsUnavailable] = useState(false);
  const [queue, setQueue] = useState<QueuedEvent[]>([]);
  const [syncVersion, setSyncVersion] = useState(0);

  const lastPos = useRef<Pos | null>(null);
  const lastPingAt = useRef(0);
  const linksRef = useRef<SavedLink[]>([]);
  const flushing = useRef(false);

  // ---- load saved state ----
  useEffect(() => {
    const l = loadLang();
    const saved = loadLinks();
    linksRef.current = saved;
    setLangState(l);
    setLinks(saved);
    setQueue(loadQueue());
    document.documentElement.lang = l;
    setHydrated(true);
  }, []);

  // ---- service worker (static shell only) ----
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/d/sw.js", { scope: "/d/" }).catch(() => {});
    }
  }, []);

  // ---- language ----
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    saveLang(l);
    document.documentElement.lang = l;
  }, []);
  const t = useCallback((key: Key, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);

  // ---- saved links ----
  const commitLinks = useCallback((next: SavedLink[]) => {
    linksRef.current = next;
    saveLinks(next);
    setLinks(next);
  }, []);

  const saveLink = useCallback<Ctx["saveLink"]>(
    (info) => commitLinks(upsertLink(loadLinks(), info)),
    [commitLinks],
  );

  const dropLink = useCallback<Ctx["dropLink"]>(
    (token, announce) => {
      const current = loadLinks();
      const gone = current.find((l) => l.token === token);
      if (!gone) return undefined;
      commitLinks(current.filter((l) => l.token !== token));
      if (announce) setNotices((n) => [...n, { id: token, company: gone.companyName }]);
      return gone;
    },
    [commitLinks],
  );

  const dismissNotice = useCallback((id: string) => setNotices((n) => n.filter((x) => x.id !== id)), []);

  // ---- location ----
  useEffect(() => {
    let status: PermissionStatus | undefined;
    let dead = false;
    const apply = (s: PermissionState) => setPerm(s === "granted" ? "granted" : s === "denied" ? "denied" : "prompt");
    const fallback = () => setPerm(locationAsked() ? "granted" : "prompt");
    if (navigator.permissions?.query) {
      navigator.permissions
        .query({ name: "geolocation" })
        .then((s) => {
          if (dead) return;
          status = s;
          apply(s.state);
          s.onchange = () => apply(s.state);
        })
        .catch(fallback);
    } else {
      fallback();
    }
    return () => {
      dead = true;
      if (status) status.onchange = null;
    };
  }, []);

  /** Reads the phone's position. This is what triggers the browser prompt: only call it after the explainer tap, or when already granted. */
  const readPosition = useCallback(
    () =>
      new Promise<Pos | null>((resolve) => {
        if (!("geolocation" in navigator)) return resolve(null);
        navigator.geolocation.getCurrentPosition(
          (p) => {
            const pos = { lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy, at: Date.now() };
            lastPos.current = pos;
            markLocationAsked();
            setGpsUnavailable(false);
            setPerm("granted");
            resolve(pos);
          },
          (err) => {
            if (err.code === err.PERMISSION_DENIED) setPerm("denied");
            else if (err.code === err.POSITION_UNAVAILABLE) setGpsUnavailable(true);
            resolve(null);
          },
          { enableHighAccuracy: true, timeout: 10_000, maximumAge: FRESH_MS },
        );
      }),
    [],
  );

  const requestLocation = useCallback(async () => {
    await readPosition();
  }, [readPosition]);

  /** For a status tap: a position under 2 minutes old, else a silent fresh read. Never prompts. */
  const positionForTap = useCallback(async (): Promise<Pos | null> => {
    const cached = lastPos.current;
    if (cached && Date.now() - cached.at < FRESH_MS) return cached;
    if (perm !== "granted") return null;
    return readPosition();
  }, [perm, readPosition]);

  const pingAll = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    if (Date.now() - lastPingAt.current < 20_000) return;
    lastPingAt.current = Date.now();
    const pos = await readPosition();
    if (!pos) return;
    await Promise.allSettled(linksRef.current.map((l) => postPing(l.token, pos)));
  }, [readPosition]);

  useEffect(() => {
    if (!hydrated || perm !== "granted" || links.length === 0) return;
    lastPingAt.current = 0; // a newly added link gets its ping straight away
    void pingAll();
    const onVisible = () => {
      if (document.visibilityState === "visible") void pingAll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [hydrated, perm, links.length, pingAll]);

  // ---- offline queue ----
  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      for (let q = loadQueue(); q.length > 0; q = loadQueue()) {
        const it = q[0];
        try {
          await postEvent(it.token, { challanId: it.challanId, type: it.type, lat: it.lat, lng: it.lng, accuracyM: it.accuracyM });
        } catch (e) {
          if (isRetryable(e)) break; // try again later
          // The office refused it (link closed, trip settled): drop it rather than block the rest.
        }
        const rest = loadQueue().filter((x) => x.id !== it.id);
        saveQueue(rest);
        setQueue(rest);
        setSyncVersion((v) => v + 1);
      }
    } finally {
      flushing.current = false;
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    void flush();
    const run = () => void flush();
    const onVisible = () => {
      if (document.visibilityState === "visible") run();
    };
    window.addEventListener("online", run);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", run);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [hydrated, flush]);

  const sendEvent = useCallback<Ctx["sendEvent"]>(
    async (token, challanId, type) => {
      const pos = await positionForTap();
      const body = { challanId, type, lat: pos?.lat ?? null, lng: pos?.lng ?? null, accuracyM: pos?.accuracyM ?? null };
      const tappedAt = new Date().toISOString();
      try {
        return { queued: false, event: await postEvent(token, body) };
      } catch (e) {
        if (!(e instanceof NetworkError)) throw e;
        const item: QueuedEvent = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          token,
          tappedAt,
          ...body,
        };
        const next = [...loadQueue(), item];
        saveQueue(next);
        setQueue(next);
        return { queued: true };
      }
    },
    [positionForTap],
  );

  const value = useMemo<Ctx>(
    () => ({
      lang, setLang, t, hydrated, links, saveLink, dropLink, notices, dismissNotice,
      perm, gpsUnavailable, requestLocation, queue, syncVersion, sendEvent,
    }),
    [lang, setLang, t, hydrated, links, saveLink, dropLink, notices, dismissNotice, perm, gpsUnavailable, requestLocation, queue, syncVersion, sendEvent],
  );

  return <DriverContext.Provider value={value}>{children}</DriverContext.Provider>;
}
