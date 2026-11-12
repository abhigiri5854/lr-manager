import { recordDriverPing } from "@/lib/data/driver-links";
import { errorResponse, json, readJson, type TokenContext } from "@/lib/driver-app/responses";

// POST /d/[token]/ping — { lat, lng, accuracyM? } last-seen location
export async function POST(req: Request, { params }: TokenContext) {
  try {
    const { token } = await params;
    const body = await readJson(req);
    if (!body || typeof body.lat !== "number" || typeof body.lng !== "number")
      return json({ error: "bad_request", message: "Location not available" }, 400);
    const accuracy = typeof body.accuracyM === "number" ? body.accuracyM : null;
    return json({ saved: await recordDriverPing(token, body.lat, body.lng, accuracy) });
  } catch (e) {
    return errorResponse(e);
  }
}
