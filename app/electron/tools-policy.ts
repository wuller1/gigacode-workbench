/** Discovery optimisation, not a sandbox: existing host scope checks still apply. */
export function roleDiscoversTool(profileId: string, name: string): boolean {
  if (
    /^(?:ask_user|todo_|artifact_|agent_|session_message|task_|workbench_reference|instruction_snapshot|memory_|app_diagnostics|role_transition_request|visual_review|context_)/.test(
      name,
    )
  )
    return true;
  if (
    profileId === "gigacode-ui" ||
    ![
      "analyst",
      "spec",
      "backend",
      "frontend",
      "devops",
      "qa",
      "reviewer",
      "diagnostics",
      "database",
      "designer",
      "security",
      "architect",
      "technical-writer",
    ].includes(profileId)
  )
    return true;
  if (name.startsWith("browser_"))
    return [
      "frontend",
      "designer",
      "qa",
      "diagnostics",
      "analyst",
      "spec",
    ].includes(profileId);
  if (name.startsWith("ide_"))
    return [
      "backend",
      "frontend",
      "database",
      "designer",
      "diagnostics",
      "reviewer",
      "architect",
      "qa",
      "security",
    ].includes(profileId);
  if (name.startsWith("database_"))
    return [
      "database",
      "backend",
      "diagnostics",
      "qa",
      "reviewer",
      "security",
      "architect",
    ].includes(profileId);
  if (name.startsWith("ops_"))
    return ["devops", "diagnostics", "qa", "security", "reviewer"].includes(
      profileId,
    );
  // New/adapter tools stay discoverable until an explicit reviewed policy exists.
  return true;
}
