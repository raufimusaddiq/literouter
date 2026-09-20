"use client";

import Link from "next/link";
import { Card } from "@/shared/components";

export default function SystemOnePage() {
  const endpoint = typeof window === "undefined" ? "/v1/systemone" : `${window.location.origin}/v1/systemone`;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">Structured decisions</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">System One</h1>
        <p className="mt-2 text-text-muted">Pass TypeSafe state and typed questions through LiteRouter to Jev.</p>
      </div>

      <Card>
        <h2 className="text-lg font-semibold">Endpoint</h2>
        <code className="mt-3 block rounded-lg bg-sidebar p-3 text-sm">POST {endpoint}</code>
        <p className="mt-3 text-sm text-text-muted">Use a LiteRouter API key in the client request. Configure the upstream TypeSafe key under Providers.</p>
        <Link href="/dashboard/providers" className="mt-4 inline-flex text-sm font-medium text-primary hover:underline">Configure TypeSafe →</Link>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">Request</h2>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-sidebar p-4 text-xs leading-5">{JSON.stringify({
          model: "jev-latest",
          state: { message: "My card was charged twice." },
          questions: {
            refund_requested: {
              type: "noul",
              instructions: "Does the customer request a refund?",
            },
          },
        }, null, 2)}</pre>
        <p className="mt-3 text-sm text-text-muted">The upstream response is returned unchanged, including typed answers and usage.</p>
      </Card>

      <p className="text-sm text-text-muted">Supported provider: TypeSafe AI · model: <code>jev-latest</code> · <a className="text-primary hover:underline" href="https://docs.typesafe.ai/api" target="_blank" rel="noreferrer">TypeSafe API docs</a></p>
    </div>
  );
}
