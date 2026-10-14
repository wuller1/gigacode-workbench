import { describe, it, expect } from "vitest";
import { statements, statementAt, identifier, literal } from "../shared/sql";
describe("PostgreSQL console lexer", () => {
  it("keeps dollar function bodies, nested comments, quoted semicolons and E escapes intact", () => {
    const sql = `/* outer /* nested ; */ ok */ CREATE FUNCTION x() RETURNS text AS $body$ BEGIN RETURN ';'; END; $body$ LANGUAGE plpgsql; SELECT E'a\\\';b', "semi;column"; -- final ;\n SELECT 3`;
    const s = statements(sql);
    expect(s).toHaveLength(3);
    expect(s[0].text).toContain("END;");
    expect(s[1].text).toContain("semi;column");
    expect(statementAt(sql, sql.indexOf("SELECT 3") + 4)).toContain("SELECT 3");
  });
  it("rejects incomplete SQL instead of executing guessed fragments", () => {
    for (const s of ["SELECT 'x", "DO $$ BEGIN", "/* x"])
      expect(() => statements(s)).toThrow(/Незакрытая/);
  });
  it("quotes identifiers and values without allowing SQL injection", () => {
    expect(identifier('a";DROP')).toBe('"a"";DROP"');
    expect(literal("a'\\b")).toBe("E'a''\\\\b'");
    expect(literal(null)).toBe("NULL");
    expect(() => identifier("x".repeat(64))).toThrow();
  });
});
