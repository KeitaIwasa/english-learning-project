import { NextResponse } from "next/server";
import { getServiceEnv } from "@/lib/service";

export async function POST(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || request.headers.get("x-cron-secret") !== cronSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { supabaseUrl, serviceRoleKey } = getServiceEnv();
    const response = await fetch(`${supabaseUrl}/functions/v1/reading-generate-daily`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey
      },
      body: JSON.stringify({})
    });

    const text = await response.text();
    return NextResponse.json({ ok: response.ok, status: response.status, body: text }, { status: response.ok ? 200 : 500 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
