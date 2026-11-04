import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { rmSync, readdirSync, existsSync } from "fs";
import { CaffeinatePlugin } from "../index";

const client: any = { app: { log: async () => {} } };
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
const ROOT = mkdtempSync(join(tmpdir(), "caff-test-"));
const DIR = join(ROOT, "state");
process.env.OPENCODE_CAFFEINATE_DIR = DIR;
const killOwn = () => {
  try {
    const pid = Number(require("fs").readFileSync(join(DIR, "caffeinate.pid"), "utf-8").trim());
    if (pid > 1) process.kill(pid, "SIGTERM");
  } catch {}
};

const sessions = () =>
  existsSync(`${DIR}/sessions`) ? readdirSync(`${DIR}/sessions`).filter((f) => f.endsWith(".session")) : [];
const awake = () => existsSync(`${DIR}/caffeinate.pid`);

const send = (h: any, type: string, sessionID = "ses_a", extra: any = {}) =>
  h.event({ event: { type, properties: { sessionID, ...extra } } });
const status = (h: any, t: string, id = "ses_a") => send(h, "session.status", id, { status: { type: t } });

let hooks: any;
beforeEach(async () => {
  killOwn();
  rmSync(DIR, { recursive: true, force: true });
  hooks = await CaffeinatePlugin({ client } as any);
});
afterAll(() => {
  killOwn();
  rmSync(DIR, { recursive: true, force: true });
});

describe("plugin events", () => {
  test("idle by default", () => expect(awake()).toBe(false));

  test("busy -> awake, idle -> asleep", async () => {
    await status(hooks, "busy");
    expect(awake()).toBe(true);
    expect(sessions().length).toBe(1);
    await status(hooks, "idle");
    expect(awake()).toBe(false);
    expect(sessions().length).toBe(0);
  });

  for (const [ask, reply] of [
    ["question.asked", "question.replied"],
    ["question.v2.asked", "question.v2.replied"],
    ["permission.asked", "permission.replied"],
    ["permission.v2.asked", "permission.v2.replied"],
    ["permission.updated", "permission.replied"],
    ["form.created", "form.replied"],
  ]) {
    test(`${ask} releases, ${reply} resumes`, async () => {
      await status(hooks, "busy");
      await send(hooks, ask!);
      expect(awake()).toBe(false);
      await send(hooks, reply!);
      expect(awake()).toBe(true);
      await status(hooks, "idle");
      expect(awake()).toBe(false);
    });
  }

  for (const t of ["form.cancelled", "session.execution.succeeded", "session.execution.failed", "session.execution.interrupted", "question.rejected", "question.v2.rejected", "session.idle", "session.error", "session.deleted"]) {
    test(`${t} releases`, async () => {
      await status(hooks, "busy");
      await send(hooks, t);
      expect(awake()).toBe(false);
    });
  }

  test("form.created carries sessionID under form", async () => {
    await status(hooks, "busy");
    await hooks.event({ event: { type: "form.created", data: { form: { id: "f1", sessionID: "ses_a" } } } });
    expect(awake()).toBe(false);
  });

  test("session.execution.started acquires", async () => {
    await send(hooks, "session.execution.started");
    expect(awake()).toBe(true);
  });

  test("dispose releases held sessions", async () => {
    await status(hooks, "busy");
    await hooks.dispose();
    expect(awake()).toBe(false);
  });

  test("retry keeps awake", async () => {
    await status(hooks, "retry");
    expect(awake()).toBe(true);
  });

  test("two sessions: stays awake until both done", async () => {
    await status(hooks, "busy", "ses_a");
    await status(hooks, "busy", "ses_b");
    expect(sessions().length).toBe(2);
    await status(hooks, "idle", "ses_a");
    expect(awake()).toBe(true);
    await status(hooks, "idle", "ses_b");
    expect(awake()).toBe(false);
  });

  test("events without sessionID are ignored", async () => {
    await hooks.event({ event: { type: "session.status", properties: {} } });
    expect(awake()).toBe(false);
  });
});
