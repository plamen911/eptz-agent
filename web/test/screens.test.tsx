import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Markdown } from "../src/Markdown";
import { api } from "../src/api";
import { Confirm } from "../src/screens/Confirm";
import { Work } from "../src/screens/Work";
import { caseView } from "./fixtures";

vi.mock("../src/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/api")>();
  return {
    ...real,
    api: {
      ...real.api,
      confirm: vi.fn(async () => ({})),
      send: vi.fn(async () => ({})),
      answer: vi.fn(async () => ({})),
    },
  };
});

beforeEach(() => vi.clearAllMocks());

describe("the check screen", () => {
  it("sends the corrected numbers and starts the writing", async () => {
    const started = vi.fn();
    render(<Confirm view={caseView()} onStarted={started} />);
    // the size is shown first; the page number waits in the folded list
    const size = screen.getByLabelText("височина на контейнера, м");
    fireEvent.change(size, { target: { value: "1,40" } });
    expect(screen.getByText("разчетено: 1,4")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Бележки към агента"), { target: { value: " Номерът на ЗМ е 251/2026. " } });
    fireEvent.click(screen.getByRole("button", { name: "Потвърди и напиши ЕПТЗ" }));

    await waitFor(() => expect(started).toHaveBeenCalled());
    expect(api.confirm).toHaveBeenCalledWith("2026-10-22-abcdef01", {
      fire_date: "2026-05-14",
      place: "Плевен",
      numbers: [
        { file: "001-p.jpg", value: "1,4", context: "височина на контейнера, м", confirmed: "1,40" },
        { file: "002-p.jpg", value: "3", context: "страница от протокола", confirmed: "3" },
      ],
      notes: "Номерът на ЗМ е 251/2026.",
    });
    expect(api.send).toHaveBeenCalledWith("2026-10-22-abcdef01");
  });
});

describe("the writing screen", () => {
  const writing = caseView({
    status: "writing",
    sessionId: "s1",
    history: [{ role: "expert", text: "Изготви ЕПТЗ и сметката.", at: "t1" }],
    progress: {
      text: "Пиша **заключението**.",
      tools: [{ name: "Bash", summary: "python3 scripts/pregled.py out/a.docx" }],
      approvals: [{ id: "a1", action: "изпращане по и-мейл", detail: "poshta.py --to x" }],
    },
  });

  it("shows the text, the steps and asks for the approval", async () => {
    render(<Work view={writing} progress={writing.progress!} onSent={() => {}} />);
    expect(screen.getByText("заключението").tagName).toBe("STRONG");
    expect(screen.getByText("Проверява документа")).toBeTruthy();
    expect((screen.getByPlaceholderText("Агентът пише…") as HTMLTextAreaElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Разреши" }));
    await waitFor(() => expect(api.answer).toHaveBeenCalledWith("2026-10-22-abcdef01", "a1", true));
  });

  it("offers the documents with the key in the link and sends a correction", async () => {
    localStorage.setItem("eptz.token", "secret key");
    const done = caseView({ status: "ready", sessionId: "s1", files: ["Ekspertiza.docx", "Smetka.xlsx"] });
    const sent = vi.fn();
    render(<Work view={done} progress={{ text: "", tools: [], approvals: [] }} onSent={sent} />);
    const link = screen.getByText("Заключение").closest("a");
    expect(link?.getAttribute("href")).toBe("/api/cases/2026-10-22-abcdef01/files/Ekspertiza.docx?token=secret%20key");
    fireEvent.change(screen.getByLabelText("Съобщение до агента"), { target: { value: "Съкрати въпрос 6." } });
    fireEvent.click(screen.getByRole("button", { name: "Изпрати" }));
    await waitFor(() => expect(sent).toHaveBeenCalled());
    expect(api.send).toHaveBeenCalledWith("2026-10-22-abcdef01", "Съкрати въпрос 6.");
  });
});

describe("Markdown", () => {
  it("renders lists and bold as elements and never as HTML", () => {
    const { container } = render(<Markdown text={"Готово:\n- **ЕПТЗ** – 8 стр.\n- сметка\n\n<img src=x onerror=alert(1)>"} />);
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});
