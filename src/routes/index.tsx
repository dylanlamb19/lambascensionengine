import { createFileRoute } from "@tanstack/react-router";
import { OwnerDesk } from "@/components/owner-desk";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <OwnerDesk />;
}
