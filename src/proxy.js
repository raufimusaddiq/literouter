import { NextResponse } from "next/server";
import { guard } from "./server/guard.js";

export default async function proxy(request) {
  return (await guard(request)) ?? NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
