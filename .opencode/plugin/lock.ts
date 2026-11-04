import { closeSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "fs";
import { randomBytes } from "crypto";

export class FileLock {
  private token: string | null = null;

  constructor(
    private path: string,
    private staleMs = 10_000,
    private timeoutMs = 3_000,
  ) {}

  async acquire(): Promise<void> {
    const deadline = Date.now() + this.timeoutMs;
    for (;;) {
      const token = `${process.pid}:${Date.now()}:${randomBytes(6).toString("hex")}`;
      try {
        const fd = openSync(this.path, "wx", 0o600);
        writeSync(fd, token);
        closeSync(fd);
        this.token = token;
        return;
      } catch (error: any) {
        if (error.code !== "EEXIST") throw error;
      }
      if (this.isStale()) {
        try {
          unlinkSync(this.path);
        } catch {}
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`timed out acquiring lock ${this.path}`);
      }
      await Bun.sleep(15);
    }
  }

  release(): void {
    if (!this.token) return;
    try {
      if (readFileSync(this.path, "utf-8") === this.token) unlinkSync(this.path);
    } catch {}
    this.token = null;
  }

  private isStale(): boolean {
    let content: string;
    try {
      content = readFileSync(this.path, "utf-8");
    } catch {
      return false;
    }
    const [pidStr, tsStr] = content.split(":");
    const pid = Number(pidStr);
    const ts = Number(tsStr);
    if (!Number.isInteger(pid) || pid <= 0 || !Number.isFinite(ts)) {
      try {
        return Date.now() - statSync(this.path).mtimeMs > this.staleMs;
      } catch {
        return false;
      }
    }
    if (Date.now() - ts > this.staleMs) return true;
    try {
      process.kill(pid, 0);
      return false;
    } catch (error: any) {
      return error.code === "ESRCH";
    }
  }
}
