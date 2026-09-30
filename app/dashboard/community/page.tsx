import { Suspense } from "react";
import { CommunityDirectoryManager } from "@/components/community/community-directory-manager";

export default function DashboardCommunityPage() {
  return <Suspense fallback={null}><CommunityDirectoryManager /></Suspense>;
}
