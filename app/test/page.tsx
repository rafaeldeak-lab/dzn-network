import Script from "next/script";

import Home from "../page";

export default function TestPage() {
  return (
    <>
      <Script id="dzn-test-route-live-source" strategy="afterInteractive">
        {`console.log("DZN TEST ROUTE USING LIVE HOMEPAGE SOURCE");`}
      </Script>
      <Home />
    </>
  );
}
