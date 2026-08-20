/**
 * Aplica supabase/schema.sql no banco.
 *
 * Existe porque colar um arquivo de trezentas linhas no SQL Editor a cada
 * mudança já falhou uma vez: a seleção não pegou até o fim, a última função
 * não foi criada, e o erro só apareceu no teste.
 *
 *   npm run db:push
 *
 * A credencial vem de .env.db.local, que fica fora do git. O app não usa
 * essa credencial — ele fala com o Supabase pela chave anon, sob RLS.
 */
import { readFileSync } from "node:fs";
import pg from "pg";

function lerEnv() {
  let cru;
  try {
    cru = readFileSync(".env.db.local", "utf8");
  } catch {
    console.error(
      "Falta .env.db.local. Precisa de SUPABASE_DB_REF, SUPABASE_DB_PASSWORD e SUPABASE_DB_REGION.",
    );
    process.exit(1);
  }

  const env = Object.fromEntries(
    cru
      .split("\n")
      .filter((l) => l.trim() && !l.trim().startsWith("#"))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
  );

  for (const chave of ["SUPABASE_DB_REF", "SUPABASE_DB_PASSWORD"]) {
    if (!env[chave]) {
      console.error(`Falta ${chave} em .env.db.local.`);
      process.exit(1);
    }
  }
  return env;
}

/**
 * Dois endereços possíveis, testados nesta ordem.
 *
 * A conexão direta é IPv6 em projetos novos, e costuma não resolver de uma
 * máquina doméstica. O pooler é IPv4 — e muda também o usuário, que passa a
 * carregar o identificador do projeto.
 *
 * Os parâmetros vão separados, nunca como URI: a senha pode conter `@` ou
 * `:`, que quebrariam a string sem ninguém perceber.
 */
function candidatos(env) {
  const regiao = env.SUPABASE_DB_REGION || "sa-east-1";
  return [
    {
      rotulo: "pooler (IPv4)",
      host: `aws-0-${regiao}.pooler.supabase.com`,
      port: 5432,
      user: `postgres.${env.SUPABASE_DB_REF}`,
      password: env.SUPABASE_DB_PASSWORD,
      database: "postgres",
      ssl: { rejectUnauthorized: false },
    },
    {
      rotulo: "conexão direta",
      host: `db.${env.SUPABASE_DB_REF}.supabase.co`,
      port: 5432,
      user: "postgres",
      password: env.SUPABASE_DB_PASSWORD,
      database: "postgres",
      ssl: { rejectUnauthorized: false },
    },
  ];
}

async function conectar(env) {
  const falhas = [];

  for (const { rotulo, ...config } of candidatos(env)) {
    const cliente = new pg.Client({ ...config, connectionTimeoutMillis: 15000 });
    try {
      await cliente.connect();
      console.log(`conectado pelo ${rotulo}`);
      return cliente;
    } catch (erro) {
      falhas.push(`  ${rotulo}: ${erro.message}`);
      await cliente.end().catch(() => {});
    }
  }

  console.error("Não consegui conectar por nenhum caminho:");
  console.error(falhas.join("\n"));
  process.exit(1);
}

const env = lerEnv();
const sql = readFileSync("supabase/schema.sql", "utf8");
const cliente = await conectar(env);

try {
  await cliente.query(sql);
  console.log("schema aplicado");

  // Não basta o comando não ter dado erro: confirmar que as peças que o app
  // chama existem mesmo é o que teria pego a função faltando da última vez.
  const { rows } = await cliente.query(`
    select p.proname as nome
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
     order by 1
  `);
  console.log(`funções em public: ${rows.map((r) => r.nome).join(", ")}`);
} catch (erro) {
  console.error(`Falhou: ${erro.message}`);
  if (erro.position) console.error(`posição ${erro.position} do arquivo`);
  process.exitCode = 1;
} finally {
  await cliente.end();
}
