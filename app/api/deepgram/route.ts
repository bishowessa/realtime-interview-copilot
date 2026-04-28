import { NextResponse } from "next/server";

export async function GET() {
  const apiKey = process.env.DEEPGRAM_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "DEEPGRAM_API_KEY is not set in environment variables" },
      { status: 500 }
    );
  }

  // The frontend expects the response to have a 'key' property
  return NextResponse.json({ key: apiKey });
}
