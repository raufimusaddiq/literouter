"use client";

import { setAppTimeZone } from "@/shared/utils/dateTime";

export default function TimezoneProvider({ timeZone, children }) {
  setAppTimeZone(timeZone);
  return children;
}
