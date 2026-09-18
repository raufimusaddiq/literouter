import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { flushRequestDetails } from "@/lib/db/index.js";

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ success: false, message: "Not allowed in production" }, { status: 403 });
  }

  const secret = process.env.SHUTDOWN_SECRET;
  const authorization = headers().get("authorization");

  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  const response = NextResponse.json({ success: true, message: "Shutting down..." });

  setTimeout(async () => {
    // Bounded drain so buffered request details survive a planned shutdown.
    try {
      await flushRequestDetails(3000);
    } catch {
      /* exiting anyway */
    }
    process.exit(0);
  }, 500);

  return response;
}
