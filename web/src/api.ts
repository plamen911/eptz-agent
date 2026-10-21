import type { CaseView, Confirmation } from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const TOKEN_KEY = "eptz.token";

/** The access key lives in this browser only; every request carries it. */
export const token = {
  get(): string {
    try {
      return localStorage.getItem(TOKEN_KEY) ?? "";
    } catch {
      return "";
    }
  },
  set(value: string): void {
    try {
      localStorage.setItem(TOKEN_KEY, value);
    } catch {
      /* private mode – the key lasts until the page closes */
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* nothing stored */
    }
  },
};

/** For <img>, <a download> and EventSource, which cannot send headers. */
export function withToken(path: string): string {
  const t = token.get();
  return t ? `${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(t)}` : path;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const t = token.get();
  if (t) headers.authorization = `Bearer ${t}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  if (!response.ok) throw new ApiError(response.status, (data as { error?: string } | undefined)?.error ?? response.statusText);
  return data as T;
}

const enc = encodeURIComponent;

export const api = {
  health: () => request<{ ok: boolean; plugin: { version: string } }>("GET", "/api/health"),
  cases: () => request<CaseView[]>("GET", "/api/cases"),
  get: (id: string) => request<CaseView>("GET", `/api/cases/${enc(id)}`),
  create: (expert: string) => request<CaseView>("POST", "/api/cases", expert.trim() ? { expert: expert.trim() } : {}),
  removePhoto: (id: string, name: string) => request<{ photos: string[] }>("DELETE", `/api/cases/${enc(id)}/photos/${enc(name)}`),
  read: (id: string) => request<unknown>("POST", `/api/cases/${enc(id)}/read`, {}),
  confirm: (id: string, c: Confirmation) => request<CaseView>("POST", `/api/cases/${enc(id)}/confirm`, c),
  send: (id: string, text?: string) => request<unknown>("POST", `/api/cases/${enc(id)}/messages`, text ? { text } : {}),
  answer: (id: string, approvalId: string, allow: boolean) =>
    request<unknown>("POST", `/api/cases/${enc(id)}/approvals/${enc(approvalId)}`, { allow }),
  photoUrl: (id: string, name: string) => withToken(`/api/cases/${enc(id)}/photos/${enc(name)}`),
  fileUrl: (id: string, name: string) => withToken(`/api/cases/${enc(id)}/files/${enc(name)}`),
  eventsUrl: (id: string, after: number) => withToken(`/api/cases/${enc(id)}/events?after=${after}`),

  /** Uploads with progress (fetch cannot report upload progress, XMLHttpRequest can). */
  upload(id: string, files: File[], onProgress: (sent: number, total: number) => void): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      for (const file of files) form.append("photo", file, file.name);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/cases/${enc(id)}/photos`);
      const t = token.get();
      if (t) xhr.setRequestHeader("authorization", `Bearer ${t}`);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded, e.total);
      xhr.onload = () => {
        const data = xhr.responseText ? (JSON.parse(xhr.responseText) as { photos?: string[]; error?: string }) : {};
        if (xhr.status >= 200 && xhr.status < 300) resolve(data.photos ?? []);
        else reject(new ApiError(xhr.status, data.error ?? "Качването не успя"));
      };
      xhr.onerror = () => reject(new ApiError(0, "Няма връзка със сървъра"));
      xhr.send(form);
    });
  },
};

/**
 * Phone photos are 3–5 MB. The reader model looks at them at most ~1600 px on the long side, so
 * anything over 2000 px is shrunk before the upload – less mobile data, same reading.
 */
export async function shrink(file: File, maxSide = 2000): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = maxSide / Math.max(bitmap.width, bitmap.height);
    if (scale >= 1) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.88));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" });
  } catch {
    return file;
  }
}
