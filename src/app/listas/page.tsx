import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ListSummary, Member, PersonColor } from "@/lib/types";
import Home from "@/components/Home";

type MembershipRow = {
  role: "owner" | "editor";
  lists: {
    id: string;
    title: string;
    owner_id: string;
    created_at: string;
  } | null;
};

export default async function ListasPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/entrar");

  // 1. As listas de que participo.
  const { data: memberships } = await supabase
    .from("list_members")
    .select("role, lists!inner(id, title, owner_id, created_at)")
    .eq("user_id", user.id)
    .order("created_at", { referencedTable: "lists", ascending: false })
    .returns<MembershipRow[]>();

  const lists = (memberships ?? [])
    .map((m) => m.lists)
    .filter((l): l is NonNullable<MembershipRow["lists"]> => l !== null);
  const listIds = lists.map((l) => l.id);

  // 2. Participantes e contagem de itens, em duas consultas para todas as listas.
  const [{ data: allMembers }, { data: allItems }] = await Promise.all([
    listIds.length
      ? supabase
          .from("list_members")
          .select("list_id, role, profiles!inner(id, display_name, color)")
          .in("list_id", listIds)
          .returns<
            {
              list_id: string;
              role: "owner" | "editor";
              profiles: { id: string; display_name: string; color: PersonColor };
            }[]
          >()
      : Promise.resolve({ data: [] as never[] }),
    listIds.length
      ? supabase
          .from("items")
          .select("list_id, done")
          .in("list_id", listIds)
          .returns<{ list_id: string; done: boolean }[]>()
      : Promise.resolve({ data: [] as never[] }),
  ]);

  const summaries: ListSummary[] = lists.map((list) => {
    const members: Member[] = (allMembers ?? [])
      .filter((m) => m.list_id === list.id)
      .map((m) => ({ ...m.profiles, role: m.role }))
      // A dona primeiro, o resto por nome — ordem estável entre renders.
      .sort((a, b) =>
        a.role === b.role
          ? a.display_name.localeCompare(b.display_name)
          : a.role === "owner"
            ? -1
            : 1,
      );

    const items = (allItems ?? []).filter((i) => i.list_id === list.id);

    return {
      ...list,
      members,
      total: items.length,
      done: items.filter((i) => i.done).length,
    };
  });

  const { data: me } = await supabase
    .from("profiles")
    .select("id, display_name, color")
    .eq("id", user.id)
    .single();

  return (
    <Home
      lists={summaries}
      me={me ?? { id: user.id, display_name: "Você", color: "mint" }}
    />
  );
}
