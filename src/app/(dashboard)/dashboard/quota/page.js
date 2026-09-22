import { Suspense } from "react";
import { CardSkeleton } from "@/shared/components/Loading";
import { PageIntro } from "@/shared/components";
import ProviderLimits from "../usage/components/ProviderLimits";

export default function QuotaPage() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <div className="flex min-w-0 flex-col gap-6">
        <PageIntro eyebrow="Capacity" title="Know which accounts can carry the next request." description="Track provider limits, reset windows, and account health before fallback becomes an incident." />
        <ProviderLimits />
      </div>
    </Suspense>
  );
}
