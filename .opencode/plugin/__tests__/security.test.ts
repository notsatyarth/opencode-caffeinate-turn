import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, symlinkSync, chmodSync, utimesSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SessionManager } from "../session-manager";
import { CaffeinateManager, isOwnCaffeinate } from "../caffeinate-manager";
import { FileLock } from "../lock";
import { ensureSecureDir, isValidSessionID } from "../paths";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "caff-sec-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("pid file is not blindly trusted", () => {
  test("does not signal an unrelated process whose pid is in the file", async () => {
    const victim = Bun.spawn(["sleep", "30"]);
    try {
      writeFileSync(join(dir, "c.pid"), String(victim.pid));
      const m = new CaffeinateManager(join(dir, "c.pid"));
      expect(m.isRunning()).toBe(false);
      await m.stop();
      await Bun.sleep(150);
      expect(victim.exitCode).toBeNull();
      expect(victim.signalCode).toBeNull();
    } finally {
      victim.kill();
    }
  });

  test("negative pid (process group) is rejected and never signalled", async () => {
    const g = Bun.spawn(["sh", "-c", "sleep 30 & sleep 30 & wait"], { detached: true });
    try {
      await Bun.sleep(150);
      for (const val of [`-${g.pid}`, "-1", "0", "1"]) {
        writeFileSync(join(dir, "c.pid"), val);
        const m = new CaffeinateManager(join(dir, "c.pid"));
        expect(m.getPid()).toBeNull();
        expect(m.isRunning()).toBe(false);
        await m.stop();
      }
      await Bun.sleep(150);
      expect(g.signalCode).toBeNull();
      expect(g.exitCode).toBeNull();
    } finally {
      try { process.kill(-g.pid, "SIGKILL"); } catch {}
    }
  });

  test("garbage / oversized pid values are rejected", () => {
    for (const val of ["abc", "12abc", "1e3", "99999999999999", "", " "]) {
      writeFileSync(join(dir, "c.pid"), val);
      expect(new CaffeinateManager(join(dir, "c.pid")).getPid()).toBeNull();
    }
  });

  test("isOwnCaffeinate accepts only a caffeinate process", async () => {
    const m = new CaffeinateManager(join(dir, "c.pid"));
    await m.start();
    try {
      expect(isOwnCaffeinate(m.getPid()!)).toBe(true);
      expect(isOwnCaffeinate(process.pid)).toBe(false);
      expect(isOwnCaffeinate(-5)).toBe(false);
      expect(isOwnCaffeinate(1)).toBe(false);
    } finally {
      await m.stop();
    }
  });

  test("pid file is written 0600", async () => {
    const m = new CaffeinateManager(join(dir, "c.pid"));
    await m.start();
    try {
      expect(statSync(join(dir, "c.pid")).mode & 0o777).toBe(0o600);
    } finally {
      await m.stop();
    }
  });
});

describe("session id / path safety", () => {
  test("isValidSessionID", () => {
    expect(isValidSessionID("ses_abc-123")).toBe(true);
    for (const bad of ["../x", "a/b", "a\\b", "", "a b", "a.b", "x".repeat(129), 5, null, undefined]) {
      expect(isValidSessionID(bad as any)).toBe(false);
    }
  });

  test("traversal ids are rejected and nothing is written outside sessions/", () => {
    const sessions = join(dir, "a", "sessions");
    const sm = new SessionManager(sessions);
    for (const id of ["../../x1", "../x", "a/../../b"]) {
      expect(() => sm.registerSession(process.pid, id)).toThrow();
      expect(() => sm.unregisterSession(process.pid, id)).toThrow();
    }
    expect(readdirSync(join(dir, "a"))).toEqual(["sessions"]);
    expect(readdirSync(dir)).toEqual(["a"]);
  });

  test("invalid pids are rejected", () => {
    const sm = new SessionManager(join(dir, "s"));
    for (const pid of [0, 1, -1, 1.5, NaN]) {
      expect(() => sm.registerSession(pid, "ses_a")).toThrow();
    }
  });

  test("session files are 0600 and foreign junk files are ignored", () => {
    const sm = new SessionManager(join(dir, "s"));
    sm.registerSession(process.pid, "ses_a");
    const f = readdirSync(join(dir, "s"))[0]!;
    expect(statSync(join(dir, "s", f)).mode & 0o777).toBe(0o600);
    writeFileSync(join(dir, "s", "1_x.session"), "");
    writeFileSync(join(dir, "s", "-5_x.session"), "");
    writeFileSync(join(dir, "s", "abc.session"), "");
    expect(sm.getActiveSessions()).toEqual([process.pid]);
  });
});

describe("state directory hardening", () => {
  test("is created 0700", () => {
    const d = join(dir, "state", "sessions");
    ensureSecureDir(d);
    expect(statSync(d).mode & 0o777).toBe(0o700);
  });

  test("loosely-permissioned existing dir is tightened", () => {
    const d = join(dir, "loose");
    mkdirSync(d, { mode: 0o755 });
    chmodSync(d, 0o755);
    ensureSecureDir(d);
    expect(statSync(d).mode & 0o777).toBe(0o700);
  });

  test("symlinked state dir is refused", () => {
    const real = join(dir, "real");
    mkdirSync(real);
    const link = join(dir, "link");
    symlinkSync(real, link);
    expect(() => ensureSecureDir(link)).toThrow();
  });
});

describe("FileLock", () => {
  test("is mutually exclusive", async () => {
    const path = join(dir, "l");
    let inside = 0;
    let maxInside = 0;
    const worker = async () => {
      const l = new FileLock(path);
      await l.acquire();
      inside++;
      maxInside = Math.max(maxInside, inside);
      await Bun.sleep(5);
      inside--;
      l.release();
    };
    await Promise.all(Array.from({ length: 12 }, worker));
    expect(maxInside).toBe(1);
    expect(existsSync(path)).toBe(false);
  });

  test("steals a lock whose owner is dead", async () => {
    const path = join(dir, "l");
    writeFileSync(path, `999999:${Date.now()}:dead`);
    const l = new FileLock(path, 10_000, 500);
    await l.acquire();
    l.release();
  });

  test("steals a lock older than the stale threshold", async () => {
    const path = join(dir, "l");
    writeFileSync(path, `${process.pid}:${Date.now() - 60_000}:old`);
    const l = new FileLock(path, 1_000, 500);
    await l.acquire();
    l.release();
  });

  test("steals a corrupt old lock file, but not a fresh one", async () => {
    const path = join(dir, "l");
    writeFileSync(path, "garbage");
    const old = new Date(Date.now() - 60_000);
    utimesSync(path, old, old);
    const l = new FileLock(path, 1_000, 500);
    await l.acquire();
    l.release();

    writeFileSync(path, "garbage");
    await expect(new FileLock(path, 60_000, 150).acquire()).rejects.toThrow(/timed out/);
  });

  test("does not steal a live, fresh lock", async () => {
    const path = join(dir, "l");
    writeFileSync(path, `${process.pid}:${Date.now()}:live`);
    await expect(new FileLock(path, 10_000, 150).acquire()).rejects.toThrow(/timed out/);
  });

  test("release does not remove a lock it no longer owns", async () => {
    const path = join(dir, "l");
    const l = new FileLock(path);
    await l.acquire();
    writeFileSync(path, "someone-else");
    l.release();
    expect(existsSync(path)).toBe(true);
  });
});
