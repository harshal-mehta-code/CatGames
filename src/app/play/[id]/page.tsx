import PlayClient from "./PlayClient";
import { GAMES } from "@/lib/registry";

export const dynamicParams = false;

export function generateStaticParams() {
  // "shuffle" isn't a module — it's the rotation layer, which builds its plan
  // client-side from the active cat's history.
  return [...GAMES.map((g) => ({ id: g.id })), { id: "shuffle" }];
}

export default async function PlayPage({ params }: PageProps<"/play/[id]">) {
  const { id } = await params;
  return <PlayClient id={id} />;
}
