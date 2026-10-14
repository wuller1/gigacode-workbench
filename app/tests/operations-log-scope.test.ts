import { it, expect } from "vitest";
import { JenkinsLogs } from "../electron/operations/jenkins-logs";
import type { OpsHttp } from "../electron/operations/http";
it("an opaque progressive log cursor cannot read a different build of the same job", async () => {
  let requests = 0;
  const http = {
    redactionPatterns: () => [],
    redactText: (s: string) => s,
    async request(_route: string, options: any) {
      requests++;
      await options.textSink(Buffer.from("old build\n".repeat(40000)));
      return { headers: { "x-text-size": "450000", "x-more-data": "false" } };
    },
  } as unknown as OpsHttp;
  const logs = new JenkinsLogs(http);
  try {
    const first = await logs.read("Team/Build", "job/Team/job/Build/7/");
    expect(first.cursor).toContain(".wb.");
    await expect(
      logs.read("Team/Build", "job/Team/job/Build/8/", first.cursor),
    ).rejects.toMatchObject({ kind: "conflict" });
    expect(requests).toBe(1);
    const continuation = await logs.read(
      "Team/Build",
      "job/Team/job/Build/7/",
      first.cursor,
    );
    expect(continuation.text).toContain("old build");
  } finally {
    await logs.dispose();
  }
});
