import { bgDate, usd } from "../format";
import type { CaseView } from "../types";
import { useCase } from "../useCase";
import { Confirm } from "./Confirm";
import { Photos } from "./Photos";
import { Work } from "./Work";

const STAGES = ["Снимки", "Проверка", "Писане", "Готово"] as const;

/** Which of the four stages the case is in – the header shows it, the body picks the screen by it. */
export function stageOf(c: CaseView): number {
  if (c.sessionId || c.status === "writing") return c.status === "writing" ? 2 : 3;
  if (c.facts) return c.status === "ready" ? 2 : 1;
  return 0;
}

export function CaseScreen({ id }: { id: string }) {
  const { view, setView, progress, error, online, reload } = useCase(id);

  if (error && !view) {
    return (
      <p className="error" role="alert">
        Делото не се зареди: {error.message}
      </p>
    );
  }
  if (!view) return <p className="muted">Зареждам делото…</p>;

  const stage = stageOf(view);
  const title = view.facts ? `${view.facts.place}, ${bgDate(view.facts.fire_date)}` : "Ново дело";

  return (
    <article className="case">
      <header className="case-head">
        <h1 className="display">{title}</h1>
        <p className="muted">
          {view.expert ? `Вещо лице: ${view.expert}. ` : ""}
          Цена до момента: <span className="num">{usd(view.costUsd)}</span>
        </p>
        <ol className="stages" aria-label="Етапи">
          {STAGES.map((name, i) => (
            <li key={name} className={i < stage ? "done" : i === stage ? "current" : ""} aria-current={i === stage ? "step" : undefined}>
              {name}
            </li>
          ))}
        </ol>
        {!online ? <p className="warn">Връзката прекъсна – опитвам отново. Работата на сървъра продължава.</p> : null}
      </header>

      {view.status === "error" || view.status === "interrupted" ? (
        <p className="error" role="alert">
          {view.status === "interrupted" ? "Работата прекъсна, докато сървърът се рестартираше." : `Грешка: ${view.error ?? "неизвестна"}`}
        </p>
      ) : null}

      {stage === 0 ? <Photos view={view} progress={progress} onChange={setView} onStarted={reload} /> : null}
      {stage === 1 || (stage === 2 && !view.sessionId && view.status !== "writing") ? (
        <Confirm view={view} onStarted={reload} />
      ) : null}
      {stage >= 2 && (view.sessionId || view.status === "writing") ? <Work view={view} progress={progress} onSent={reload} /> : null}
    </article>
  );
}
