import { NextResponse } from "next/server";
import { databaseConfigured } from "../../../lib/database";
import { databaseReadiness } from "../../../lib/migrate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const database = await databaseReadiness();
  return NextResponse.json({
    ok: true,
    service: "transcripter",
    database: {
      configured: databaseConfigured(),
      ready: Boolean(database.configured && !database.error),
      error: database.error || null,
    },
    timestamp: new Date().toISOString(),
  });
}
