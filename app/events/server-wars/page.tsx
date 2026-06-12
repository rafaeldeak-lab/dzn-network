import { Suspense } from "react";

import { ServerWarsPage } from "@/components/server-wars/server-wars-platform";

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#02030a] text-white" />}>
      <ServerWarsPage />
    </Suspense>
  );
}
