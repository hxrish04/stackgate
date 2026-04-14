// app/api/validate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { validateTicketSpec } from "@/lib/validation";
import { runPolicyEngine } from "@/lib/policy-engine";

export async function POST(req: NextRequest) {
  const spec = await req.json();
  const validation = validateTicketSpec(spec);
  const policy = validation.valid ? runPolicyEngine(spec) : null;
  return NextResponse.json({ validation, policy });
}
