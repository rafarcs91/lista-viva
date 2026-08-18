export type PersonColor = "mint" | "violet" | "amber" | "coral" | "sky";

export type Profile = {
  id: string;
  display_name: string;
  color: PersonColor;
};

export type Item = {
  id: string;
  list_id: string;
  name: string;
  qty: number;
  done: boolean;
  added_by: string | null;
  checked_by: string | null;
  created_at: string;
  updated_at: string;
};

export type Member = Profile & { role: "owner" | "editor" };

export type ListSummary = {
  id: string;
  title: string;
  owner_id: string;
  created_at: string;
  members: Member[];
  total: number;
  done: number;
};
