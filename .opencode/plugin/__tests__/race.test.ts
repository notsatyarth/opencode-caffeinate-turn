import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const CORE = join(import.meta.dir, "..", "core");
const countOwn = (dir: string) => {
  const r = Bun.spawnSync(["pgrep", "-x", "caffeinate"]);
  const all = r.stdout.toString().trim().split("\n").filter(Boolean);
  return all.length;
};

test("N processes starting at once spawn exactly one caffeinate, and it stops after all finish", async () => {
  const dir = join(mkdtempSync(join(tmpdir(), "caff-race-")), "state");
  const N = 8;
  const before = countOwn(dir);
  const startAt = Date.now() + 1500;
  const script = `
    import { createController } from ${JSON.stringify(CORE)};
    const c = createController(() => {});
    const id = process.env.SES_ID;
    while (Date.now() < ${startAt}) {}
    await c.handle({ type: "session.status", data: { sessionID: id, status: { type: "busy" } } });
    await Bun.sleep(1500);
    await c.handle({ type: "session.status", data: { sessionID: id, status: { type: "idle" } } });
  `;
  const procs = Array.from({ length: N }, (_, i) =>
    Bun.spawn(["bun", "-e", script], {
      env: { ...process.env, OPENCODE_CAFFEINATE_DIR: dir, SES_ID: `ses_${i}` },
      stdout: "ignore",
      stderr: "pipe",
    }),
  );
  try {
    await Bun.sleep(2300);
    expect(countOwn(dir) - before).toBe(1);
    await Promise.all(procs.map((p) => p.exited));
    await Bun.sleep(300);
    expect(countOwn(dir) - before).toBe(0);
    expect(readdirSync(join(dir, "sessions"))).toEqual([]);
  } finally {
    for (const p of procs) p.kill();
    try {
      const pid = Number(readFileSync(join(dir, "caffeinate.pid"), "utf-8"));
      if (pid > 1) process.kill(pid, "SIGTERM");
    } catch {}
    rmSync(join(dir, ".."), { recursive: true, force: true });
  }
}, 30000);
