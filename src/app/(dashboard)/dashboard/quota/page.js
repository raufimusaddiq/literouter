import { Suspense } from "react";
import { CardSkeleton } from "@/shared/components/Loading";
import PageIntro from "@/shared/components/PageIntro";
import ProviderLimits from "../usage/components/ProviderLimits";

export default function QuotaPage() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <div className="flex min-w-0 flex-col gap-6">
        <PageIntro title="Quota" description="Provider limits, reset windows, and account health." />
        <ProviderLimits />
      </div>
    </Suspense>
  );
}
