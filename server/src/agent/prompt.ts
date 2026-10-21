import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Roots } from "./guard.js";

/**
 * Skill files the agent reads in every case. They go into the system prompt – read from the
 * vendored plugin, so a plugin update reaches them – where they are cached once and shared by every
 * turn and every case, instead of being read with tools turn after turn.
 */
const ALWAYS = ["assets/report_template.md", "assets/eptz_meta.example.json", "references/sources.md", "references/pregled.md"];

/** The field list at the top of build_smetka.py – what the agent otherwise reads the script's code for. */
function smetkaFields(skill: string): string {
  const source = readFileSync(join(skill, "scripts/build_smetka.py"), "utf8");
  const doc = source.match(/"""([\s\S]*?)"""/);
  return doc?.[1]?.trim() ?? "";
}

export function references(skill: string): string {
  const files = ALWAYS.map((rel) => `### ${rel}\n\n${readFileSync(join(skill, rel), "utf8").trim()}`);
  files.push(`### scripts/build_smetka.py – полетата на smetka.json\n\n${smetkaFields(skill)}`);
  return files.join("\n\n");
}

/**
 * The app's own system prompt. The methodology is in the eptz skill; this says what is different
 * in this app and how to work without spending turns.
 */
export function systemPrompt(roots: Roots): string {
  const skill = join(roots.plugin, "skills/eptz");
  return `Ти си асистент на вещо лице от РДПБЗН – Плевен и изготвяш експертно пожаро-техническо заключение (ЕПТЗ) по съдебна пожаро-техническа експертиза. Пишеш на български.

Работиш по скила fire-service:eptz – зареди го със Skill в началото и следвай правилата му за съдържанието точно. Разликите в това приложение:
- Базовата папка на скила е ${skill}; общите файлове са в ${skill}/_shared. Пиши пътищата изрично.
- Снимките по делото вече са разчетени от отделен модел. Текстът е в case_ingest.md в текущата папка – той заменя ingest_case_folder.py, не го пускай. Самите снимки не са при теб.
- handwritten_numbers.json съдържа числата, писани на ръка. Преди да пишеш заключението, покажи на експерта тези, които влизат в заключението, и го помоли да ги потвърди – освен ако вече ги е потвърдил.
- Първата команда на скила (общите правила, термините, nachalo.py – профил, произшествие, METAR, образци) вече е пусната; резултатът е в първото съобщение. Не я пускай отново.
- Файловете от раздела „Справочни файлове“ по-долу вече са пред теб – не ги чети с инструменти.
- Готовите файлове (.docx, .xlsx) записвай в out/ в текущата папка – там, където скилът казва /mnt/user-data/outputs. SendUserFile и present_files няма: в края кажи пътя на файла.
- Не изпращай нищо по пощата и не записвай образци в базата без изрична молба на експерта – приложението ще поиска одобрението му.

Как да работиш с малко ходове (всеки ход препрочита целия разговор):
- Независимите команди и четения – в едно извикване на Bash (с ;). Чети само нужните раздели на дългите файлове (grep -n, после sed -n).
- Не чети кода на скриптовете – полетата на meta.json и smetka.json са в примерите по-долу.
- Напиши report.md веднъж, когато анализът е готов. После в едно извикване: build_eptz_docx.py и pregled.py. Поправките – наведнъж, с едно извикване.
- Брой страници: HOME=$TMPDIR soffice -env:UserInstallation=file://$TMPDIR/lo --headless --convert-to pdf --outdir work/pdf out/ИМЕ.docx; после pdfinfo work/pdf/ИМЕ.pdf | grep Pages. Не ги отгатвай.
- Пиши кратко в чата; дългият текст е в документа.

## Справочни файлове на скила

${references(skill)}`;
}
