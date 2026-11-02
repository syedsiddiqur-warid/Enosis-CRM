import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { canImport } from "@/lib/crm/import-core";
import { keyFromRequest, runIntake } from "@/lib/crm/intake";

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Lead generation tools post companies here with an access key from Settings › Intake API.
 * Body: one company, an array of companies, or { companies: [...], source?, batch? }. Add ?dryRun=1 to check without saving.
 */
export async function POST(req: Request) {
  const key = await keyFromRequest(req);
  if (!key) return NextResponse.json({ error: "Missing, wrong or revoked API key" }, { status: 401 });
  if (!key.createdById) return NextResponse.json({ error: "This key has no owner; create a new one" }, { status: 403 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) return NextResponse.json({ error: "Request is larger than 5 MB; send fewer companies at a time" }, { status: 413 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "The body isn't valid JSON" }, { status: 400 });
  }
  const dryRun = /^(1|true|yes)$/i.test(new URL(req.url).searchParams.get("dryRun") ?? "");
  try {
    await canImport(key.createdById);
    const result = await runIntake(body, { ...key, createdById: key.createdById }, dryRun);
    if (!dryRun && (result.created || result.updated)) {
      revalidatePath("/research");
      revalidatePath("/companies", "layout");
    }
    return NextResponse.json({ dryRun, ...result }, { status: dryRun ? 200 : result.created ? 201 : 200 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Something went wrong" }, { status: 400 });
  }
}
