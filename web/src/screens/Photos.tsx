import { type ChangeEvent, useState } from "react";
import { api, shrink } from "../api";
import type { CaseView, Progress } from "../types";

interface Props {
  view: CaseView;
  progress: Progress;
  onChange: (v: CaseView) => void;
  onStarted: () => void;
}

/** Stage 1: photos of the materials – from the camera or the gallery – then the reading. */
export function Photos({ view, progress, onChange, onStarted }: Props) {
  const [upload, setUpload] = useState<{ sent: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const reading = view.status === "reading";

  async function add(e: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (picked.length === 0) return;
    setError("");
    setUpload({ sent: 0, total: 1 });
    try {
      const files = await Promise.all(picked.map((f) => shrink(f)));
      const photos = await api.upload(view.id, files, (sent, total) => setUpload({ sent, total }));
      onChange({ ...view, photos });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUpload(null);
    }
  }

  async function remove(name: string) {
    try {
      const { photos } = await api.removePhoto(view.id, name);
      onChange({ ...view, photos });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function read() {
    setError("");
    try {
      await api.read(view.id);
      onStarted();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (reading) {
    const done = progress.read?.done ?? 0;
    const total = progress.read?.total ?? view.photos.length;
    return (
      <section className="stack" aria-live="polite">
        <h2>Разчитам материалите</h2>
        <progress max={total} value={done} />
        <p className="muted">
          {done} от {total} страници. Около 2–3 секунди на страница.
        </p>
      </section>
    );
  }

  return (
    <section className="stack">
      <h2>Снимките на материалите</h2>
      <p className="muted">Постановлението, протоколът за оглед, докладните, обясненията и снимките от албума – по една страница на снимка, в реда на делото.</p>

      {view.photos.length > 0 ? (
        <ol className="thumbs">
          {view.photos.map((name, i) => (
            <li key={name}>
              <img src={api.photoUrl(view.id, name)} alt={`Страница ${i + 1}`} loading="lazy" />
              <span className="thumb-no">{i + 1}</span>
              <button type="button" className="thumb-remove" onClick={() => remove(name)} aria-label={`Махни страница ${i + 1}`}>
                ×
              </button>
            </li>
          ))}
        </ol>
      ) : null}

      <div className="row">
        <label className="button">
          Снимай
          <input type="file" accept="image/*" capture="environment" onChange={add} hidden />
        </label>
        <label className="button">
          От галерията
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={add} hidden />
        </label>
      </div>

      {upload ? (
        <div aria-live="polite">
          <progress max={upload.total} value={upload.sent} />
          <p className="muted">Качвам…</p>
        </div>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <button className="primary" disabled={view.photos.length === 0 || upload !== null} onClick={read}>
        {view.photos.length === 0 ? "Добавете снимки" : `Разчети ${view.photos.length} ${view.photos.length === 1 ? "страница" : "страници"}`}
      </button>
    </section>
  );
}
