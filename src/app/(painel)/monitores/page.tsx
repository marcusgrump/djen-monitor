import type { Metadata } from "next";
import { MonitoresView } from "./monitores-view";

export const metadata: Metadata = { title: "Monitores" };

export default function Page() {
  return <MonitoresView />;
}
