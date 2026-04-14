// app/api/ai/parse/route.ts
import { NextRequest, NextResponse } from "next/server";
import { parseNaturalLanguageRequest } from "@/lib/ai-parser";

export async function POST(req: NextRequest) {
  const { input } = await req.json();
  if (!input?.trim()) {
    return NextResponse.json({ error: "input is required" }, { status: 400 });
  }
  try {
    const result = await parseNaturalLanguageRequest(input);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Parse failed" },
      { status: 500 }
    );
  }
}
