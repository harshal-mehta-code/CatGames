import PlayClient from "./PlayClient";
import { GAMES } from "@/lib/registry";

export const dynamicParams = false;

export function generateStaticParams() {
  return GAMES.map((g) => ({ id: g.id }));
}

export default async function PlayPage({ params }: PageProps<"/play/[id]">) {
  const { id } = await params;
  return <PlayClient id={id} />;
}
