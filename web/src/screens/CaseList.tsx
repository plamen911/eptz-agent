import { type FormEvent, useEffect, useState } from "react";
import { go } from "../App";
import { api } from "../api";
import { STATUS, bgDate, bgDateTime, usd } from "../format";
import type { CaseView } from "../types";

export function CaseList() {
  const [cases, setCases] = useState<CaseView[] | null>(null);
  const [expert, setExpert] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.cases().then(setCases, () => setError("Делата не се заредиха. Проверете връзката и презаредете."));
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const c = await api.create(expert);
      go(`/case/${c.id}`);
    } catch {
      setError("Делото не се създаде. Опитайте отново.");
      setBusy(false);
    }
  }

  return (
    <div className="stack-lg">
      <form onSubmit={create} className="new-case">
        <h1 className="display">Ново дело</h1>
        <label htmlFor="expert">Вещо лице</label>
        <input
          id="expert"
          value={expert}
          onChange={(e) => setExpert(e.target.value)}
          placeholder="Име и фамилия – празно, ако сте Вие"
          autoComplete="name"
        />
        <button className="primary" disabled={busy}>
          {busy ? "Създавам…" : "Започни"}
        </button>
      </form>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      {cases && cases.length > 0 ? (
        <section aria-labelledby="cases-h">
          <h2 id="cases-h">Дела</h2>
          <ul className="case-list">
            {cases.map((c) => (
              <li key={c.id}>
                <a href={`#/case/${c.id}`} className="case-row">
                  <span className="case-title">
                    {c.facts ? `${c.facts.place}, ${bgDate(c.facts.fire_date)}` : `${c.photos.length} снимки`}
                  </span>
                  <span className={`status status-${c.status}`}>{STATUS[c.status]}</span>
                  <span className="muted">
                    {bgDateTime(c.createdAt)}
                    {c.expert ? `, ${c.expert}` : ""}
                  </span>
                  <span className="muted num">{usd(c.costUsd)}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : cases ? (
        <p className="muted">Още няма дела. Започнете с първото – трябват Ви само снимките на материалите.</p>
      ) : null}
    </div>
  );
}
