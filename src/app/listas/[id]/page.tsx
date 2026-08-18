import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Item, Member, PersonColor, Profile } from "@/lib/types";
import ListaView from "@/components/ListaView";

export default async function ListaPage({ params }: PageProps<"/listas/[id]">) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/entrar");

  // O RLS já garante que só membro enxerga a lista: se voltar vazio,
  // ou a lista não existe ou esta pessoa não faz parte dela.
  const { data: list } = await supabase
    .from("lists")
    .select("id, title, owner_id")
    .eq("id", id)
    .maybeSingle();

  if (!list) notFound();

  const [{ data: memberRows }, { data: items }, { data: me }] = await Promise.all([
    supabase
      .from("list_members")
      .select("role, profiles!inner(id, display_name, color)")
      .eq("list_id", id)
      .returns<
        {
          role: "owner" | "editor";
          profiles: { id: string; display_name: string; color: PersonColor };
        }[]
      >(),
    supabase
      .from("items")
      .select("*")
      .eq("list_id", id)
      .order("created_at", { ascending: true })
      .returns<Item[]>(),
    supabase.from("profiles").select("id, display_name, color").eq("id", user.id).single(),
  ]);

  const members: Member[] = (memberRows ?? [])
    .map((m) => ({ ...m.profiles, role: m.role }))
    .sort((a, b) =>
      a.role === b.role
        ? a.display_name.localeCompare(b.display_name)
        : a.role === "owner"
          ? -1
          : 1,
    );

  const profile: Profile = me ?? { id: user.id, display_name: "Você", color: "mint" };

  return (
    <ListaView
      list={list}
      initialItems={items ?? []}
      initialMembers={members}
      me={profile}
    />
  );
}
