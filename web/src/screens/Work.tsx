import { type FormEvent, useEffect, useRef, useState } from "react";
import { Markdown } from "../Markdown";
import { api } from "../api";
import { stepLabel } from "../format";
import type { CaseView, Progress } from "../types";

interface Props {
  view: CaseView;
  progress: Progress;
  onSent: () => void;
}

/** Stages 3 and 4: the agent writing, live – and afterwards the documents and corrections. */
export function Work({ view, progress, onSent }: Props) {
  const writing = view.status === "writing";
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (writing) end.current?.scrollIntoView?.({ block: "end", behavior: "smooth" });
  }, [writing, progress.text.length, progress.tools.length]);

  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.send(view.id, text.trim() || "Продължи.");
      setText("");
      onSent();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function answer(approvalId: string, allow: boolean) {
    try {
      await api.answer(view.id, approvalId, allow);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="work">
      {view.files.length > 0 ? (
        <div className="files" aria-label="Документи">
          {view.files.map((f) => (
            <a key={f} href={api.fileUrl(view.id, f)} download={f} className="file">
              <span className="file-kind">{f.endsWith(".xlsx") ? "Сметка" : f.endsWith(".docx") ? "Заключение" : "Файл"}</span>
              <span className="file-name">{f}</span>
            </a>
          ))}
        </div>
      ) : null}

      <ol className="conversation">
        {view.history.map((m) => (
          <li key={m.at} className={m.role === "expert" ? "said-expert" : "said-agent sheet"}>
            {m.role === "agent" ? <Markdown text={m.text} /> : <p>{m.text}</p>}
          </li>
        ))}
        {writing ? (
          <li className="said-agent sheet live" aria-live="polite" aria-busy="true">
            {progress.tools.length > 0 ? (
              <ol className="steps" aria-label="Стъпки">
                {progress.tools.map((t, i) => (
                  <li key={i} title={t.summary} className={i === progress.tools.length - 1 ? "now" : ""}>
                    {stepLabel(t.name, t.summary)}
                  </li>
                ))}
              </ol>
            ) : null}
            <div className="live-text">
              {progress.text ? <Markdown text={progress.text} /> : <p className="muted">Агентът чете материалите и мисли – текстът идва след малко.</p>}
            </div>
            {progress.approvals.map((a) => (
              <div key={a.id} className="approval" role="alertdialog" aria-labelledby={`a${a.id}`}>
                <p id={`a${a.id}`}>
                  Агентът иска разрешение за <strong>{a.action}</strong>.
                </p>
                <pre>{a.detail}</pre>
                <div className="row">
                  <button className="primary" onClick={() => answer(a.id, true)}>
                    Разреши
                  </button>
                  <button onClick={() => answer(a.id, false)}>Откажи</button>
                </div>
              </div>
            ))}
          </li>
        ) : null}
      </ol>
      <div ref={end} />

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <form className="composer" onSubmit={send}>
        <label htmlFor="msg" className="visually-hidden">
          Съобщение до агента
        </label>
        <textarea
          id="msg"
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={writing ? "Агентът пише…" : "Поправка или въпрос"}
          disabled={writing}
        />
        <button className="primary" disabled={writing || busy || (!text.trim() && view.status !== "error" && view.status !== "interrupted")}>
          {view.status === "error" || view.status === "interrupted" ? "Продължи" : "Изпрати"}
        </button>
      </form>
    </section>
  );
}
