// Driver app: what lives in the phone's localStorage. Every access is guarded (private mode, blocked storage).
import type { TripEventType } from "@/lib/types";
import type { Lang } from "./i18n";

export type SavedLink = {
  token: string;
  companyName: string;
  driverName: string;
  officePhone: string | null;
  addedAt: string;
};

export type QueuedEvent = {
  id: string;
  token: string;
  challanId: string;
  type: TripEventType;
  /** When the driver tapped (shown in the app; the server stamps the time it receives it). */
  tappedAt: string;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
};

export type Pos = { lat: number; lng: number; accuracyM: number; at: number };

const LINKS = "lrm.driver.links";
const LANG = "lrm.driver.lang";
const QUEUE = "lrm.driver.queue";
const ASKED = "lrm.driver.locAsked";

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the app still works for this session */
  }
}

export const loadLinks = () => read<SavedLink[]>(LINKS, []);
export const saveLinks = (l: SavedLink[]) => write(LINKS, l);

/** Add or update a link: same token → updated in place; same company + same driver → replaces the older token. */
export function upsertLink(
  links: SavedLink[],
  info: { token: string; companyName: string; driverName: string; officePhone: string | null },
): SavedLink[] {
  const existing = links.find((l) => l.token === info.token);
  const rest = links.filter(
    (l) => l.token !== info.token && !(l.companyName === info.companyName && l.driverName === info.driverName),
  );
  return [{ ...info, addedAt: existing?.addedAt ?? new Date().toISOString() }, ...rest];
}

export function loadLang(): Lang {
  return read<string>(LANG, "hi") === "en" ? "en" : "hi";
}
export const saveLang = (l: Lang) => write(LANG, l);

export const loadQueue = () => read<QueuedEvent[]>(QUEUE, []);
export const saveQueue = (q: QueuedEvent[]) => write(QUEUE, q);

/** For browsers without the Permissions API: has the driver already pressed the location button? */
export const locationAsked = () => read<boolean>(ASKED, false);
export const markLocationAsked = () => write(ASKED, true);
