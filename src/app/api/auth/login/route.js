import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { verifyPassword } from "@/lib/auth/password.js";
import { cookies } from "next/headers";
import { setDashboardAuthCookie } from "@/lib/auth/dashboardSession";
import { checkLock, recordSuccess, getClientIp, beginAttempt } from "@/lib/auth/loginLimiter";
import { isLocalRequest } from "@/dashboardGuard";

const RESET_HINT = "Forgot password? Reset to default via LiteRouter CLI → Settings → Reset Password to Default.";
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function POST(request) {
  try {
    const ip = getClientIp(request);
    const attempt = beginAttempt(ip);
    if (attempt.locked) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${attempt.retryAfter}s. ${RESET_HINT}`, retryAfter: attempt.retryAfter, resetHint: RESET_HINT },
        { status: 429, headers: { "Retry-After": String(attempt.retryAfter) } }
      );
    }

    const { password } = await request.json();
    const settings = await getSettings();

    const storedHash = settings.password;

    let isValid = false;
    if (storedHash) {
      isValid = await verifyPassword(password, storedHash);
    } else {
      const initialPassword = process.env.INITIAL_PASSWORD || "123456";
      isValid = password === initialPassword;
    }

    if (isValid) {
      recordSuccess(ip);

      const mustChangePassword =
        !storedHash && !process.env.INITIAL_PASSWORD && !isLocalRequest(request);

      if (mustChangePassword) {
        return NextResponse.json(
          { success: false, error: "Default password must be changed before remote access. Change it from the local machine (or set INITIAL_PASSWORD).", mustChangePassword },
          { status: 403, headers: NO_STORE_HEADERS }
        );
      }

      const cookieStore = await cookies();
      await setDashboardAuthCookie(cookieStore, request);

      return NextResponse.json({ success: true, mustChangePassword: false }, { headers: NO_STORE_HEADERS });
    }

    const postLock = checkLock(ip);
    if (postLock.locked) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${postLock.retryAfter}s. ${RESET_HINT}`, retryAfter: postLock.retryAfter, resetHint: RESET_HINT },
        { status: 429, headers: { "Retry-After": String(postLock.retryAfter) } }
      );
    }
    return NextResponse.json(
      { error: `Invalid password. ${attempt.remainingBeforeLock} attempt(s) left before lockout.`, remainingBeforeLock: attempt.remainingBeforeLock },
      { status: 401 }
    );
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
