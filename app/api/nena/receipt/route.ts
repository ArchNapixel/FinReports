import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGenerationQuota, consumeGeneration } from "@/lib/nena/quota";
import { extractReceipt, needsAttention } from "@/lib/nena/receipt";
import { NenaRateLimitError, NenaUnavailableError } from "@/lib/nena/gemini";
import { PH_STANDARD_COA } from "@/lib/ledger/chart-of-accounts";

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { remaining } = await getGenerationQuota(supabase, user.id);
  if (remaining <= 0) return NextResponse.json({ error: "Daily generate limit reached" }, { status: 429 });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  // Nena only reads images. Signal that up front — no Gemini call, no quota spent —
  // so the caller can hand the file to the plain CSV parser right away.
  if (!file.type.startsWith("image/")) return NextResponse.json({ unreadable: true });

  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");

  try {
    const extraction = await extractReceipt(
      { mimeType: file.type, base64 },
      PH_STANDARD_COA.map((a) => ({ code: a.code, name: a.name }))
    );
    await consumeGeneration(supabase);
    return NextResponse.json({ extraction, flags: needsAttention(extraction) });
  } catch (e) {
    if (e instanceof NenaRateLimitError) return NextResponse.json({ error: e.message }, { status: 429 });
    if (e instanceof NenaUnavailableError) return NextResponse.json({ error: e.message }, { status: 503 });
    console.error(e);
    return NextResponse.json({ error: "Nena couldn't read that file" }, { status: 500 });
  }
}
