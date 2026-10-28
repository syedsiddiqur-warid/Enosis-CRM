import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { Home } from "@/components/home/home";
import { loadHome } from "@/lib/crm/home-loader";

export const metadata = { title: "Home" };

export default async function HomePage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return <Home data={await loadHome(user.id)} />;
}
