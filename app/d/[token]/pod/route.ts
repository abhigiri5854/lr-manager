import { uploadDriverPod } from "@/lib/data/driver-links";
import { DRIVER_POD_MAX_BYTES } from "@/lib/driver-link";
import { errorResponse, json, type TokenContext } from "@/lib/driver-app/responses";

const text = (v: FormDataEntryValue | null) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

// POST /d/[token]/pod — multipart: file, challanId, lrId, packages?, deliveredOn? (≤ 10 MB)
export async function POST(req: Request, { params }: TokenContext) {
  try {
    const { token } = await params;
    const declared = Number(req.headers.get("content-length") ?? 0);
    // Room for the form fields around the 10 MB file.
    if (declared > DRIVER_POD_MAX_BYTES + 256 * 1024)
      return json({ error: "too_large", message: "File is larger than 10 MB" }, 413);

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!form || !(file instanceof File)) return json({ error: "bad_request", message: "Choose a photo or file" }, 400);
    if (file.size > DRIVER_POD_MAX_BYTES) return json({ error: "too_large", message: "File is larger than 10 MB" }, 413);

    const packages = text(form.get("packages"));
    const result = await uploadDriverPod(
      token,
      text(form.get("challanId")) ?? "",
      text(form.get("lrId")) ?? "",
      { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) },
      { deliveredOn: text(form.get("deliveredOn")), packages: packages === undefined ? undefined : Number(packages) },
    );
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
