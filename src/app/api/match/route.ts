import { NextResponse } from "next/server";
import { INITIAL_SMES, INITIAL_SESSIONS } from "@/lib/data";
import { runMatchingEngine } from "@/lib/matcher";

export async function GET() {
  const result = runMatchingEngine(INITIAL_SMES, INITIAL_SESSIONS);
  return NextResponse.json({
    success: true,
    smes: INITIAL_SMES,
    sessions: INITIAL_SESSIONS,
    ...result
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { smes = INITIAL_SMES, sessions = INITIAL_SESSIONS } = body;
    const result = runMatchingEngine(smes, sessions);
    return NextResponse.json({
      success: true,
      smes,
      sessions,
      ...result
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
