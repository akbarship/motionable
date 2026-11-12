export interface SpawnSpec {
  cmd: string;
  args: string[];
  shell: boolean;
}

/**
 * How to launch `npx <args>` on a platform. On win32 npx is a .cmd shim, which Node >= 20.12 refuses
 * to spawn without a shell (CVE-2024-27980 hardening), so shell:true is required there.
 * SAFETY: with shell:true every arg must be a fixed literal or a number made by us, never user input.
 */
export function npxCommand(platform: NodeJS.Platform, args: string[]): SpawnSpec {
  return platform === 'win32' ? { cmd: 'npx.cmd', args, shell: true } : { cmd: 'npx', args, shell: false };
}

/** Reads `hyperframes doctor --json`: its `.ok` wins; without a usable `.ok` the exit status decides. */
export function doctorReportOk(stdout: string, exitedOk: boolean): boolean {
  try {
    const v: unknown = JSON.parse(stdout);
    if (typeof v === 'object' && v !== null && typeof (v as { ok?: unknown }).ok === 'boolean') {
      return exitedOk && (v as { ok: boolean }).ok;
    }
  } catch {
    // not JSON: fall through
  }
  return exitedOk;
}

const WIN_ARG_RE = /^[A-Za-z0-9._:\/=,@%+-]+$/;

/** win32 runs npx.cmd through a shell, so agent-supplied args must be plain tokens. Throws on others. */
export function validateHfArgs(platform: NodeJS.Platform, args: string[]): string[] {
  if (platform === 'win32') {
    for (const a of args) {
      if (!WIN_ARG_RE.test(a)) throw new Error(`argument not allowed on Windows: ${JSON.stringify(a)}`);
    }
  }
  return args;
}
