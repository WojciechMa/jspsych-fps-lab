// Turns jsPsych trial records into what goes to a server: a compact record (one JSON line of
// result data) and the measures' raw outputs as separate files.
export interface ResultFile {
  name: string;
  content: string | Uint8Array<ArrayBuffer>;
  type: string;
}

type Results = Record<string, { summary?: unknown; raw?: unknown; error?: string; raw_file?: string }>;

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Moves each measure's raw output into a file named after the trial index and measure id. */
export function splitRecord(record: Record<string, unknown>): { compact: Record<string, unknown>; files: ResultFile[] } {
  const results = record.results as Results | undefined;
  if (!results || typeof results !== 'object') return { compact: record, files: [] };
  const index = String(record.trial_index ?? 'x').padStart(3, '0');
  const files: ResultFile[] = [];
  const compactResults: Results = {};
  for (const [id, result] of Object.entries(results)) {
    if (result.raw === undefined) {
      compactResults[id] = result;
      continue;
    }
    // The demo is base64 of a Doom demo lump: stored as the binary .lmp file.
    const file: ResultFile =
      id === 'demo' && typeof result.raw === 'string'
        ? { name: `trial-${index}-demo.lmp`, content: fromBase64(result.raw), type: 'application/octet-stream' }
        : { name: `trial-${index}-${id}.json`, content: JSON.stringify(result.raw), type: 'application/json' };
    files.push(file);
    const { raw: _raw, ...rest } = result;
    compactResults[id] = { ...rest, raw_file: file.name };
  }
  return { compact: { ...record, results: compactResults }, files };
}
