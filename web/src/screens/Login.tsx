import { type FormEvent, useState } from "react";
import { ApiError } from "../api";

export function Login({ onDone }: { onDone: (key: string) => void }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/cases", { headers: { authorization: `Bearer ${key.trim()}` } });
      if (response.status === 401) throw new ApiError(401, "Ключът не е верен. Проверете го и опитайте отново.");
      if (!response.ok) throw new ApiError(response.status, "Сървърът не отговаря. Опитайте след малко.");
      onDone(key.trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Няма връзка със сървъра.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <h1 className="display">ЕПТЗ</h1>
      <p className="lede">Експертно пожаро-техническо заключение от снимките по делото.</p>
      <form onSubmit={submit} className="stack">
        <label htmlFor="key">Ключ за достъп</label>
        <input id="key" type="password" autoComplete="current-password" value={key} onChange={(e) => setKey(e.target.value)} required />
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <button className="primary" disabled={busy || !key.trim()}>
          {busy ? "Проверявам…" : "Влез"}
        </button>
      </form>
    </main>
  );
}
