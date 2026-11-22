"use client";

import { setAppTimeZone } from "@/shared/utils/dateTime";

// Sets the app timezone synchronously during render (before children), so the
// SSR pass and hydration format dates in the same zone.
export default function TimezoneProvider({ timeZone, children }) {
  setAppTimeZone(timeZone);
  return children;
}
