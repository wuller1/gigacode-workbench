import { useMemo } from "react";
/** Server EXPLAIN JSON only. Estimated costs are never presented as measured time. */
export function SqlPlan({ value }: { value: unknown }) {
  const plan = useMemo(() => {
    try {
      const parsed = typeof value === "string" ? JSON.parse(value) : value;
      return Array.isArray(parsed) ? parsed[0] : undefined;
    } catch {
      return undefined;
    }
  }, [value]);
  if (!plan?.Plan)
    return (
      <div className="db-grid-empty">Сервер не вернул EXPLAIN FORMAT JSON.</div>
    );
  let count = 0;
  const node = (p: any, depth: number): React.ReactNode => {
    if (++count > 5000 || depth > 100)
      return (
        <p>
          Часть большого плана скрыта. Полный JSON доступен в результате
          запроса.
        </p>
      );
    return (
      <details className="db-plan-node" open key={count}>
        <summary>
          <strong>{p["Node Type"]}</strong>
          {p["Relation Name"] && (
            <span>
              {p["Schema"] ? p["Schema"] + "." : ""}
              {p["Relation Name"]}
            </span>
          )}
          {p["Index Name"] && <span>{p["Index Name"]}</span>}
          <span className="db-spacer" />
          <span title="Оценка PostgreSQL">
            cost {p["Startup Cost"]}–{p["Total Cost"]} · {p["Plan Rows"]} строк
          </span>
          {Object.prototype.hasOwnProperty.call(p, "Actual Total Time") && (
            <span title="Измерено при ANALYZE">
              {p["Actual Total Time"]} мс · {p["Actual Rows"]} строк ×{" "}
              {p["Actual Loops"]}
            </span>
          )}
        </summary>
        <div className="db-plan-properties">
          {Object.entries(p)
            .filter(
              ([k, v]) =>
                k !== "Plans" &&
                ![
                  "Node Type",
                  "Relation Name",
                  "Index Name",
                  "Schema",
                  "Startup Cost",
                  "Total Cost",
                  "Plan Rows",
                  "Actual Total Time",
                  "Actual Rows",
                  "Actual Loops",
                ].includes(k) &&
                typeof v !== "object",
            )
            .map(([k, v]) => (
              <span key={k}>
                <b>{k}</b> {String(v)}
              </span>
            ))}
        </div>
        {(p.Plans || []).map((child: any) => node(child, depth + 1))}
      </details>
    );
  };
  return (
    <div className="db-plan">
      <div className="db-inline">
        <strong>
          {plan["Execution Time"] !== undefined
            ? "EXPLAIN ANALYZE"
            : "EXPLAIN · оценка"}
        </strong>
        {plan["Planning Time"] !== undefined && (
          <span>Планирование {plan["Planning Time"]} мс</span>
        )}
        {plan["Execution Time"] !== undefined && (
          <span>Выполнение {plan["Execution Time"]} мс</span>
        )}
      </div>
      {node(plan.Plan, 0)}
    </div>
  );
}
