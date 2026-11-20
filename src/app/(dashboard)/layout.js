import DashboardLayout from "@/shared/components/layouts/DashboardLayout";
import TimezoneProvider from "@/shared/components/TimezoneProvider";
import { getServerTimeZone } from "@/shared/utils/dateTime";

// TZ is a runtime env var: never bake the build machine's zone into the page.
export const dynamic = "force-dynamic";

export default function DashboardRootLayout({ children }) {
  return (
    <TimezoneProvider timeZone={getServerTimeZone()}>
      <DashboardLayout>{children}</DashboardLayout>
    </TimezoneProvider>
  );
}
