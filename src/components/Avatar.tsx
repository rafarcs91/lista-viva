import type { PersonColor } from "@/lib/types";

export function initialsOf(name: string) {
  const clean = name.trim();
  return clean ? clean[0]!.toUpperCase() : "?";
}

export default function Avatar({
  name,
  color,
  live = false,
}: {
  name: string;
  color: PersonColor;
  live?: boolean;
}) {
  return (
    <span
      className={`avatar${live ? " is-live" : ""}`}
      data-color={color}
      title={live ? `${name} está com a lista aberta` : name}
    >
      {initialsOf(name)}
    </span>
  );
}
