/**
 * Public (portfolio) version of a report: deterministic masking so company
 * data does not leave as is. Project and client names become "프로젝트 A",
 * "고객사 A"; words the user lists become "[비공개]"; links, e-mail
 * addresses and phone numbers are removed; money and large absolute numbers
 * become "[수치]" while rates (%, %p) and small counts stay.
 * This reduces risk; it does not replace checking the company's rules.
 */
export type Masking = {
  projects: string[];
  clients: string[];
  hidden: string[];
};

const letter = (i: number) =>
  i < 26 ? String.fromCharCode(65 + i) : `Z${i - 25}`;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function parseHidden(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 2),
    ),
  ].slice(0, 100);
}

export function maskText(text: string, m: Masking): string {
  // Longest names first so "Galaxy Coach Pro" wins over "Galaxy Coach".
  const pairs: [string, string][] = [
    ...m.projects.map(
      (n, i) => [n, `프로젝트 ${letter(i)}`] as [string, string],
    ),
    ...m.clients.map((n, i) => [n, `고객사 ${letter(i)}`] as [string, string]),
    ...m.hidden.map((n) => [n, "[비공개]"] as [string, string]),
  ]
    .filter(([n]) => n.trim().length >= 2)
    .sort((a, b) => b[0].length - a[0].length);
  let out = text
    .replace(/https?:\/\/\S+/g, "[링크]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[이메일]")
    .replace(
      /(\+?\d{1,3}[-.\s]?)?(0\d{1,2}|\(\d{2,3}\))[-.\s]?\d{3,4}[-.\s]?\d{4}/g,
      "[전화번호]",
    );
  for (const [name, alias] of pairs)
    out = out.replace(new RegExp(escape(name), "gi"), alias);
  return (
    out
      // Money and unit-scaled amounts: 1.2억, 71조, 3,000만 원, $5M, ₩1,000
      .replace(
        /[₩$]\s?\d[\d,.]*\s?[KMB]?|\d[\d,.]*\s?(조|억|만|천)\s?(원|달러)?|\d[\d,.]*\s?(원|달러|USD|KRW)/gi,
        "[수치]",
      )
      // Large absolute numbers (4+ digits) unless they are a rate or a date part.
      .replace(
        /(?<![\d.\-/])\d{1,3}(,\d{3})+(?![\d%])|(?<![\d.\-/])\d{4,}(?![\d%\-/])/g,
        (n) => (/^(19|20)\d{2}$/.test(n) ? n : "[수치]"),
      )
  );
}
