/** Minimal in-memory SpreadsheetApp spreadsheet for running the .gs files in tests. */
export function fakeSpreadsheet(initial: Record<string, string[][]> = {}) {
  const grids = new Map<string, string[][]>(
    Object.entries(initial).map(([k, v]) => [k, v.map((r) => [...r])]),
  );
  let active = "";
  const put = (name: string, r: number, c: number, v: unknown) => {
    const g = grids.get(name)!;
    while (g.length < r) g.push([]);
    const row = g[r - 1];
    while (row.length < c) row.push("");
    row[c - 1] = String(v);
  };
  const sheet = (name: string) => ({
    getName: () => name,
    clearContents: () => void grids.set(name, []),
    getDataRange: () => ({
      getValues: () => (grids.get(name) ?? []).map((r) => [...r]),
    }),
    getRange: (r: number, c: number, nr = 1, nc = 1) => {
      const range = {
        setNumberFormat: () => range,
        setValue: (v: unknown) => {
          put(name, r, c, v);
          return range;
        },
        setValues: (rows: unknown[][]) => {
          if (rows.length !== nr || rows.some((x) => x.length !== nc))
            throw new Error("setValues size mismatch");
          rows.forEach((x, i) =>
            x.forEach((v, j) => put(name, r + i, c + j, v)),
          );
          return range;
        },
        activate: () => range,
      };
      return range;
    },
    activate: () => void (active = name),
  });
  const ss = {
    getSheetByName: (n: string) => (grids.has(n) ? sheet(n) : null),
    insertSheet: (n: string) => {
      grids.set(n, []);
      return sheet(n);
    },
  };
  return { ss, grids, active: () => active };
}
