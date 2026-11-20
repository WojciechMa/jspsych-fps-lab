// Participant-facing page HTML shared by the study timeline and the builder's preview.
import { participantDescriptions } from '../measures/registry';
import { allTrials, DEFAULT_CONTENT_WARNING, type StudyConfig, trialMeasures } from './config';

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function warningHtml(config: StudyConfig): string {
  return `<h1>Before you start</h1><p>${escapeHtml(config.content_warning ?? DEFAULT_CONTENT_WARNING)}</p>`;
}

/** Title, the researchers' text, the union of all trials' recorded data and where it goes. */
export function consentHtml(config: StudyConfig, consentText: string): string {
  const ids = allTrials(config).flatMap((trial) =>
    trialMeasures(trial).map((spec) => (typeof spec === 'string' ? spec : spec.id)),
  );
  const recorded = participantDescriptions(ids).map((line) => `<li>${line}</li>`).join('');
  return `
      <h1>${escapeHtml(config.title)}</h1>
      ${config.consent_html ?? ''}
      <p>While you play, the game records:</p>
      <ul class="recorded">${recorded}</ul>
      <p>No name or other personal details are recorded. ${escapeHtml(consentText)}</p>`;
}
