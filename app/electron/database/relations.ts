import type { Client } from "pg";
import type { DatabaseRelations } from "../../shared/database";

export const DATABASE_RELATION_LIMITS = Object.freeze({
  nodes: 30,
  edges: 50,
  columnsPerNode: 8,
});

/**
 * Read one bounded, direct FK neighborhood from the real PostgreSQL catalog.
 * One SQL statement gives a consistent catalog view for this response. It does
 * not begin a transaction or keep a schema snapshot alive after the response.
 * Use the lease's availability guard around this helper, like describe().
 */
export async function readDatabaseRelations(
  client: Pick<Client, "query">,
  oid: string,
): Promise<DatabaseRelations> {
  if (!/^\d{1,10}$/.test(oid) || Number(oid) < 1 || Number(oid) > 4294967295)
    throw new Error("Некорректный OID таблицы для диаграммы связей");

  const result = await client.query<{ graph: string }>(
    `WITH root AS (
       SELECT c.oid, n.nspname, c.relname, c.relkind
       FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
       WHERE c.oid=$1::oid AND c.relkind IN ('r','p','f')
     ), all_edges AS MATERIALIZED (
       SELECT c.* FROM pg_catalog.pg_constraint c
       WHERE c.contype='f'
         AND EXISTS (SELECT 1 FROM root r WHERE r.oid IN (c.conrelid,c.confrelid))
     ), all_nodes AS (
       SELECT oid FROM root
       UNION SELECT conrelid FROM all_edges
       UNION SELECT confrelid FROM all_edges
     ), eligible_nodes AS MATERIALIZED (
       SELECT c.oid, n.nspname, c.relname, c.relkind
       FROM all_nodes a
       JOIN pg_catalog.pg_class c ON c.oid=a.oid
       JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
       ORDER BY (c.oid=$1::oid) DESC, n.nspname COLLATE "C", c.relname COLLATE "C", c.oid
       LIMIT $2
     ), edges AS MATERIALIZED (
       SELECT e.* FROM all_edges e
       JOIN eligible_nodes s ON s.oid=e.conrelid
       JOIN eligible_nodes t ON t.oid=e.confrelid
       ORDER BY s.nspname COLLATE "C", s.relname COLLATE "C",
         t.nspname COLLATE "C", t.relname COLLATE "C", e.conname COLLATE "C", e.oid
       LIMIT $3
     ), shown_nodes AS (
       SELECT oid FROM root
       UNION SELECT conrelid FROM edges
       UNION SELECT confrelid FROM edges
     ), nodes AS (
       SELECT n.*,
         (SELECT count(*) FROM pg_catalog.pg_attribute a
           WHERE a.attrelid=n.oid AND a.attnum>0 AND NOT a.attisdropped) AS column_count,
         COALESCE((SELECT jsonb_agg(jsonb_build_object(
           'ordinal',a.attnum, 'name',a.attname,
           'type',pg_catalog.format_type(a.atttypid,a.atttypmod),
           'primaryKey',EXISTS (SELECT 1 FROM pg_catalog.pg_constraint p
             WHERE p.conrelid=n.oid AND p.contype='p' AND a.attnum=ANY(p.conkey))
         ) ORDER BY a.attnum) FROM (
           SELECT a.* FROM pg_catalog.pg_attribute a
           WHERE a.attrelid=n.oid AND a.attnum>0 AND NOT a.attisdropped
           ORDER BY a.attnum LIMIT $4
         ) a),'[]'::jsonb) AS columns
       FROM eligible_nodes n JOIN shown_nodes s ON s.oid=n.oid
     )
     SELECT jsonb_build_object(
       'rootOid',(SELECT oid::text FROM root),
       'capturedAt',to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
       'scope','direct-foreign-keys',
       'nodes',COALESCE((SELECT jsonb_agg(jsonb_build_object(
         'oid',n.oid::text, 'schema',n.nspname, 'name',n.relname, 'kind',n.relkind,
         'columns',n.columns, 'columnCount',n.column_count, 'columnsTruncated',n.column_count>$4
       ) ORDER BY (n.oid=$1::oid) DESC,n.nspname COLLATE "C",n.relname COLLATE "C",n.oid) FROM nodes n),'[]'::jsonb),
       'edges',COALESCE((SELECT jsonb_agg(jsonb_build_object(
         'oid',e.oid::text, 'name',e.conname,
         'sourceOid',e.conrelid::text, 'targetOid',e.confrelid::text,
         'columns',COALESCE((SELECT jsonb_agg(jsonb_build_object(
           'ordinal',k.position, 'source',s.attname, 'target',t.attname
         ) ORDER BY k.position)
           FROM unnest(e.conkey,e.confkey) WITH ORDINALITY AS k(source_attnum,target_attnum,position)
           JOIN pg_catalog.pg_attribute s ON s.attrelid=e.conrelid AND s.attnum=k.source_attnum
           JOIN pg_catalog.pg_attribute t ON t.attrelid=e.confrelid AND t.attnum=k.target_attnum
         ),'[]'::jsonb),
         'onUpdate',CASE e.confupdtype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
           WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END,
         'onDelete',CASE e.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
           WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END,
         'match',CASE e.confmatchtype WHEN 's' THEN 'SIMPLE' WHEN 'f' THEN 'FULL' WHEN 'p' THEN 'PARTIAL' END,
         'validated',e.convalidated, 'deferrable',e.condeferrable, 'initiallyDeferred',e.condeferred
       ) ORDER BY e.conrelid,e.confrelid,e.conname COLLATE "C",e.oid) FROM edges e),'[]'::jsonb),
       'totals',jsonb_build_object('nodes',(SELECT count(*) FROM all_nodes),'edges',(SELECT count(*) FROM all_edges)),
       'limits',jsonb_build_object('nodes',$2,'edges',$3,'columnsPerNode',$4),
       'truncated',(SELECT count(*) FROM all_nodes)>(SELECT count(*) FROM nodes)
         OR (SELECT count(*) FROM all_edges)>(SELECT count(*) FROM edges)
         OR EXISTS (SELECT 1 FROM nodes WHERE column_count>$4)
     )::text AS graph`,
    [
      oid,
      DATABASE_RELATION_LIMITS.nodes,
      DATABASE_RELATION_LIMITS.edges,
      DATABASE_RELATION_LIMITS.columnsPerNode,
    ],
  );
  const graph = JSON.parse(
    result.rows[0]?.graph || "null",
  ) as DatabaseRelations | null;
  if (!graph?.rootOid)
    throw new Error(
      "Таблица больше не существует или не поддерживает внешние ключи",
    );
  return graph;
}
