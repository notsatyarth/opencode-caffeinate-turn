import { test, expect, mock, beforeEach } from "bun:test";
import { rmSync, existsSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
const DIR = join(mkdtempSync(join(tmpdir(), "caff-v2-")), "state");
process.env.OPENCODE_CAFFEINATE_DIR = DIR;
const killOwn = () => {
  try {
    const pid = Number(require("fs").readFileSync(join(DIR, "caffeinate.pid"), "utf-8").trim());
    if (pid > 1) process.kill(pid, "SIGTERM");
  } catch {}
};


mock.module("@opencode/plugin", () => ({ Plugin: { define: (d: any) => d } }));
const awake = () => existsSync(join(DIR, "caffeinate.pid"));

beforeEach(() => {
  killOwn();
  rmSync(DIR, { recursive: true, force: true });
});

test("v2 entry subscribes to events and tears down", async () => {
  const mod: any = (await import("../v2")).default;
  expect(mod.id).toBe("caffeinate");

  const queue: any[] = [];
  let wake: (() => void) | null = null;
  const ctx = {
    event: {
      subscribe: async function* ({ signal }: any) {
        while (!signal.aborted) {
          if (!queue.length) await new Promise<void>((r) => ((wake = r), setTimeout(r, 20)));
          while (queue.length) yield queue.shift();
        }
      },
    },
  };
  const push = (e: any) => (queue.push(e), wake?.());
  const cleanup = mod.setup(ctx);

  push({ type: "session.status", data: { sessionID: "ses_v2", status: { type: "busy" } } });
  await Bun.sleep(150);
  expect(awake()).toBe(true);

  push({ type: "form.created", data: { form: { sessionID: "ses_v2" } } });
  await Bun.sleep(150);
  expect(awake()).toBe(false);

  push({ type: "form.replied", data: { sessionID: "ses_v2" } });
  await Bun.sleep(150);
  expect(awake()).toBe(true);

  cleanup();
  await Bun.sleep(150);
  expect(awake()).toBe(false);
});
