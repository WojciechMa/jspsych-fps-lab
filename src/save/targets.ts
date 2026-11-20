// Where a study's data goes (config.save.target). Uploads happen only in save steps between
// trials, never during play.
import type { StudyConfig } from '../study/config';
import { splitRecord } from './records';

export interface SaveTarget {
  readonly id: StudyConfig['save']['target'];
  /** Consent sentence: where the data goes and what happens to incomplete sessions. */
  readonly consentText: string;
  /** Sends the records produced since the last call. */
  send(records: Record<string, unknown>[]): Promise<void>;
  /** The session is complete; may leave the page (JATOS end page or completion URL). */
  finish(completionUrl?: string): Promise<void>;
  /** Deletes what was sent; may leave the page. */
  withdraw(reason: string): Promise<void>;
}

/** The subset of jatos.js (3.11) used here. */
interface Jatos {
  onLoad(callback: () => void): void;
  componentInput: unknown;
  urlQueryParameters: Record<string, string>;
  appendResultData(data: string): Promise<unknown>;
  uploadResultFile(data: Blob, filename: string): Promise<unknown>;
  endStudy(successful?: boolean, message?: string): unknown;
  endStudyAndRedirect(url: string, successful?: boolean, message?: string): Promise<unknown>;
  abortStudy(message?: string): unknown;
}

declare global {
  interface Window {
    jatos?: Jatos;
  }
}

/** jatos.js once it is ready, or null outside JATOS. */
export function waitForJatos(): Promise<Jatos | null> {
  const jatos = window.jatos;
  if (!jatos) return Promise.resolve(null);
  return new Promise((resolve) => jatos.onLoad(() => resolve(jatos)));
}

/** Consent sentence per implemented target. */
export const CONSENT_TEXT: Partial<Record<StudyConfig['save']['target'], string>> = {
  download:
    'Your data stays in this browser: nothing is sent anywhere. At the end you can look at it and ' +
    'download it as a file.',
  jatos:
    "Your data is sent to the research team's JATOS server after each game round. If you stop " +
    'early, what was sent so far is kept but used only to fix technical problems. At the end you ' +
    'can look at your data, download a copy, and submit it or withdraw, which deletes everything ' +
    'that was sent.',
};

const download: SaveTarget = {
  id: 'download',
  consentText: CONSENT_TEXT.download!,
  async send() {},
  async finish(completionUrl) {
    if (completionUrl) location.assign(completionUrl);
  },
  async withdraw() {},
};

function jatosTarget(jatos: Jatos): SaveTarget {
  return {
    id: 'jatos',
    consentText: CONSENT_TEXT.jatos!,
    async send(records) {
      for (const record of records) {
        const { compact, files } = splitRecord(record);
        for (const file of files) {
          await jatos.uploadResultFile(new Blob([file.content], { type: file.type }), file.name);
        }
        // One JSON object per line (NDJSON): appendResultData concatenates strings.
        await jatos.appendResultData(`${JSON.stringify(compact)}\n`);
      }
    },
    async finish(completionUrl) {
      if (completionUrl) await jatos.endStudyAndRedirect(completionUrl, true, 'completed');
      else await jatos.endStudy(true, 'completed');
    },
    async withdraw(reason) {
      await jatos.abortStudy(reason);
    },
  };
}

export function createSaveTarget(config: StudyConfig, jatos: Jatos | null): SaveTarget {
  switch (config.save.target) {
    case 'download':
      return download;
    case 'jatos':
      if (!jatos) throw new Error('This study saves its data to JATOS: open it through its JATOS study link.');
      return jatosTarget(jatos);
    case 'datapipe':
      throw new Error('Saving to DataPipe is prepared in the study format but not implemented yet.');
  }
}
