import { driverTrips, openDriverLink } from "@/lib/data/driver-links";
import { errorResponse, json, linkGone, type TokenContext } from "@/lib/driver-app/responses";

// GET /d/[token]/trips[?open=1] — the driver + their trips. open=1 also records "link opened".
export async function GET(req: Request, { params }: TokenContext) {
  try {
    const { token } = await params;
    if (new URL(req.url).searchParams.get("open") === "1" && !(await openDriverLink(token))) return linkGone();
    const result = await driverTrips(token);
    return result ? json(result) : linkGone();
  } catch (e) {
    return errorResponse(e);
  }
}
