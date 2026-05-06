// In-memory registry of live Playwright pages per running job, so the
// dashboard can show a remote-control panel (screenshots + click/type
// forwarding). Pages are unregistered when a job ends.

type RemoteEntry = {
  page: any;
  width: number;
  height: number;
};

const remotes = new Map<string, RemoteEntry>();

export function registerRemote(jobId: string, page: any, viewport = { width: 1280, height: 720 }) {
  remotes.set(jobId, { page, width: viewport.width, height: viewport.height });
}

export function unregisterRemote(jobId: string) {
  remotes.delete(jobId);
}

export function getRemote(jobId: string): RemoteEntry | null {
  return remotes.get(jobId) ?? null;
}

export async function snapshot(jobId: string): Promise<{
  png: string;
  url: string;
  width: number;
  height: number;
} | null> {
  const r = remotes.get(jobId);
  if (!r) return null;
  try {
    const buf: Buffer = await r.page.screenshot({ type: 'png', fullPage: false });
    return {
      png: buf.toString('base64'),
      url: r.page.url(),
      width: r.width,
      height: r.height,
    };
  } catch {
    return null;
  }
}

export async function click(jobId: string, x: number, y: number) {
  const r = remotes.get(jobId);
  if (!r) return false;
  try {
    await r.page.mouse.click(x, y);
    return true;
  } catch {
    return false;
  }
}

export async function pressKey(jobId: string, key: string) {
  const r = remotes.get(jobId);
  if (!r) return false;
  try {
    await r.page.keyboard.press(key);
    return true;
  } catch {
    return false;
  }
}

export async function typeText(jobId: string, text: string) {
  const r = remotes.get(jobId);
  if (!r) return false;
  try {
    await r.page.keyboard.type(text, { delay: 30 });
    return true;
  } catch {
    return false;
  }
}
