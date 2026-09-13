import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export async function GET() {
  try {
    const pool = await getPool();
    await pool.query("SELECT 1");
    return NextResponse.json({
      ok: true,
      tier: "rag_chat_100k",
      dauTarget: 100000,
      redisConfigured: Boolean(
        process.env.UPSTASH_REDIS_REST_URL?.trim() && process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
      ),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 503 }
    );
  }
}
