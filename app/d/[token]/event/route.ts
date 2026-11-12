import { recordDriverEvent } from "@/lib/data/driver-links";
import { errorResponse, json, readJson, type TokenContext } from "@/lib/driver-app/responses";

// POST /d/[token]/event — { challanId, type, lat?, lng?, accuracyM? }
export async function POST(req: Request, { params }: TokenContext) {
  try {
    const { token } = await params;
    const body = await readJson(req);
    if (!body) return json({ error: "bad_request", message: "Invalid request" }, 400);
    return json(await recordDriverEvent(token, body as Parameters<typeof recordDriverEvent>[1]));
  } catch (e) {
    return errorResponse(e);
  }
}
