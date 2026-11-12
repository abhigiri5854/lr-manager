// Driver app: calls to the session-less /d/[token]/* routes. Client side.
import type { DriverHistory, DriverLinkInfo, DriverPodResult, DriverTrip, TripEvent, TripEventType } from "@/lib/types";
import type { Pos } from "./storage";

/** The request never reached the server (offline, dropped). */
export class NetworkError extends Error {
  constructor() {
    super("network");
    this.name = "NetworkError";
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** 404 from trips/history = the link is missing, revoked or expired. */
export const isLinkGone = (e: unknown) => e instanceof ApiError && e.status === 404;
/** Worth sending again later (network, rate limit, server trouble) rather than dropping. */
export const isRetryable = (e: unknown) => e instanceof NetworkError || (e instanceof ApiError && (e.status === 429 || e.status >= 500));

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, cache: "no-store", credentials: "omit" });
  } catch {
    throw new NetworkError();
  }
  const body = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
  if (!res.ok) throw new ApiError(res.status, body?.message ?? "Request failed", body?.error);
  return body as T;
}

const base = (token: string) => `/d/${encodeURIComponent(token)}`;
const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const fetchTrips = (token: string, open = false) =>
  call<{ driver: DriverLinkInfo; trips: DriverTrip[] }>(`${base(token)}/trips${open ? "?open=1" : ""}`);

export const fetchHistory = (token: string, before?: string | null) =>
  call<DriverHistory>(`${base(token)}/history${before ? `?before=${encodeURIComponent(before)}` : ""}`);

export const postEvent = (
  token: string,
  body: { challanId: string; type: TripEventType; lat: number | null; lng: number | null; accuracyM: number | null },
) => call<TripEvent>(`${base(token)}/event`, post(body));

export const postPing = (token: string, pos: Pos) =>
  call<{ saved: boolean }>(`${base(token)}/ping`, post({ lat: pos.lat, lng: pos.lng, accuracyM: pos.accuracyM }));

/** Multipart upload with progress (fetch has no upload progress). Not queued: the caller shows Retry. */
export function uploadPod(token: string, form: FormData, onProgress: (percent: number) => void): Promise<DriverPodResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${base(token)}/pod`);
    xhr.timeout = 120_000;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let body: (DriverPodResult & { error?: string; message?: string }) | null = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300 && body) resolve(body);
      else reject(new ApiError(xhr.status, body?.message ?? "Upload failed", body?.error));
    };
    xhr.onerror = () => reject(new NetworkError());
    xhr.ontimeout = () => reject(new NetworkError());
    xhr.send(form);
  });
}
