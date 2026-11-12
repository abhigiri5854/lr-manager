import { driverHistory } from "@/lib/data/driver-links";
import { errorResponse, json, linkGone, type TokenContext } from "@/lib/driver-app/responses";

// GET /d/[token]/history[?before=yyyy-mm-dd]
export async function GET(req: Request, { params }: TokenContext) {
  try {
    const { token } = await params;
    const result = await driverHistory(token, new URL(req.url).searchParams.get("before"));
    return result ? json(result) : linkGone();
  } catch (e) {
    return errorResponse(e);
  }
}
