import { json, cookies } from "@/server/http.js";
import { LOCALE_COOKIE, normalizeLocale, isSupportedLocale } from "@/i18n/config";

export async function POST(request) {
  try {
    const { locale } = await request.json();
    
    if (!locale || !isSupportedLocale(locale)) {
      return json(
        { error: "Invalid locale" },
        { status: 400 }
      );
    }

    const normalized = normalizeLocale(locale);
    const cookieStore = cookies(request);
    cookieStore.set(LOCALE_COOKIE, normalized, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });

    return json({ success: true, locale: normalized });
  } catch (error) {
    return json(
      { error: "Failed to set locale" },
      { status: 500 }
    );
  }
}
