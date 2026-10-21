import { type FormEvent, useState } from "react";
import { api } from "../api";
import { sortNumbers } from "../format";
import type { CaseView, Confirmation, HandwrittenNumber } from "../types";

type Row = HandwrittenNumber & { confirmed: string; key: string };

/** The rows the expert edits – each handwritten number with the value to use, as read at first. */
export function initialRows(view: CaseView): Row[] {
  const before = view.confirmation?.numbers ?? [];
  return view.numbers.map((n, i) => ({
    ...n,
    key: `${i}`,
    confirmed: before.find((b) => b.file === n.file && b.value === n.value && b.context === n.context)?.confirmed ?? n.value,
  }));
}

/** What goes to the server: the rows without the React key. */
export function toConfirmation(date: string, place: string, rows: Row[], notes: string): Confirmation {
  return {
    fire_date: date,
    place: place.trim(),
    numbers: rows.map(({ key: _key, ...n }) => ({ ...n, confirmed: n.confirmed.trim() || n.value })),
    notes: notes.trim(),
  };
}

/**
 * Stage 2: everything the reading could get wrong, on one screen – checked once, so the agent
 * then writes the whole report without stopping to ask.
 */
export function Confirm({ view, onStarted }: { view: CaseView; onStarted: () => void }) {
  const [date, setDate] = useState(view.confirmation?.fire_date ?? view.facts?.fire_date ?? "");
  const [place, setPlace] = useState(view.confirmation?.place ?? view.facts?.place ?? "");
  const [rows, setRows] = useState(() => initialRows(view));
  const [notes, setNotes] = useState(view.confirmation?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { important, other } = sortNumbers(rows);

  const edit = (key: string, confirmed: string) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, confirmed } : r)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.confirm(view.id, toConfirmation(date, place, rows, notes));
      await api.send(view.id);
      onStarted();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const numberRow = (r: Row) => (
    <li key={r.key} className="number-row">
      <a href={api.photoUrl(view.id, r.file)} target="_blank" rel="noreferrer" className="number-photo">
        <img src={api.photoUrl(view.id, r.file)} alt={`Снимката, от която е разчетено: ${r.context}`} loading="lazy" />
      </a>
      <label htmlFor={`n${r.key}`} className="number-context">
        {r.context}
      </label>
      <input
        id={`n${r.key}`}
        value={r.confirmed}
        onChange={(e) => edit(r.key, e.target.value)}
        className={r.confirmed !== r.value ? "changed" : ""}
        inputMode="text"
      />
      {r.confirmed !== r.value ? <span className="muted small">разчетено: {r.value}</span> : null}
    </li>
  );

  return (
    <form className="stack" onSubmit={submit}>
      <h2>Проверете разчетеното</h2>
      <p className="muted">Ръкописът е най-честият източник на грешки. Поправете каквото не е вярно – агентът ще ползва тези стойности, без да пита отново.</p>

      <div className="grid-2">
        <div className="stack-sm">
          <label htmlFor="date">Дата на пожара</label>
          <input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <div className="stack-sm">
          <label htmlFor="place">Населено място</label>
          <input id="place" value={place} onChange={(e) => setPlace(e.target.value)} required />
        </div>
      </div>

      {important.length > 0 ? (
        <section className="stack-sm">
          <h3>Числата, писани на ръка, които влизат в заключението</h3>
          <ul className="numbers">{important.map(numberRow)}</ul>
        </section>
      ) : null}
      {other.length > 0 ? (
        <details>
          <summary>Други числа на ръка ({other.length})</summary>
          <ul className="numbers">{other.map(numberRow)}</ul>
        </details>
      ) : null}

      <div className="stack-sm">
        <label htmlFor="notes">Бележки към агента</label>
        <textarea
          id="notes"
          rows={5}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Например: номерът на ЗМ е 251/2026; огледът е на 15.05.2026 г. от 00:45 ч.; контейнерите са 1,40 м високи."
        />
      </div>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="primary" disabled={busy || !date || !place.trim()}>
        {busy ? "Започвам…" : "Потвърди и напиши ЕПТЗ"}
      </button>
    </form>
  );
}
