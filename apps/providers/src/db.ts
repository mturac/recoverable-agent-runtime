import postgres from "postgres";

export type Sql = ReturnType<typeof postgres>;

export function createSql(url?: string): Sql {
  return postgres(
    url ?? process.env.DATABASE_URL ?? "postgres://rar:rar@localhost:5432/rar",
    { max: 10 },
  );
}
