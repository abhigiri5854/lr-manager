// Shown by the service worker when a /d/ page can't be reached. Static: no data, no token.
export default function DriverOfflinePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-3 bg-page p-8 text-center">
      <h1 className="text-2xl font-semibold">इंटरनेट नहीं है</h1>
      <p className="text-lg text-muted">नेट आने पर दोबारा खोलें।</p>
      <p className="text-base text-muted">No internet. Open again when you have network.</p>
    </main>
  );
}
