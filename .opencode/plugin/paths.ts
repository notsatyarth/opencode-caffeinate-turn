import { chmodSync, lstatSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

export const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export const isValidSessionID = (id: unknown): id is string =>
  typeof id === "string" && SESSION_ID_RE.test(id);

export const currentUid = (): number =>
  typeof process.getuid === "function" ? process.getuid() : -1;

export function defaultBaseDir(): string {
  return process.env.OPENCODE_CAFFEINATE_DIR || join(tmpdir(), `opencode-caffeinate-${currentUid()}`);
}

export function ensureSecureDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = lstatSync(dir);
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throw new Error(`${dir} is not a plain directory`);
  }
  if (currentUid() !== -1 && st.uid !== currentUid()) {
    throw new Error(`${dir} is not owned by the current user`);
  }
  if ((st.mode & 0o077) !== 0) {
    chmodSync(dir, 0o700);
  }
}
