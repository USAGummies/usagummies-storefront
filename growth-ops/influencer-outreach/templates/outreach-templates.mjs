// ============================================================================
// USA Gummies — Outreach Message Templates
// ============================================================================
//
// Each template is a function that accepts an influencer object and returns
// the final message string. Placeholders like {{RECENT_TOPIC}} are left as
// literal markers for manual customization before sending.
// ============================================================================

import { BRAND } from '../config.mjs';

// ---------------------------------------------------------------------------
// Helper: pick a first-name or fall back to username
// ---------------------------------------------------------------------------
function displayName(influencer) {
  return influencer.firstName || influencer.username || 'there';
}

// ---------------------------------------------------------------------------
// A) Fan First
// ---------------------------------------------------------------------------
export function fanFirst(influencer) {
  const name = displayName(influencer);
  const niche = influencer.niches?.[0] || '{{THEIR_NICHE}}';
  return [
    `Hey ${name}! I've been following your content about ${niche} and love what you're doing.`,
    `I'm ${BRAND.founderName}, the founder of ${BRAND.name} -- we make all-natural gummy bears right here in America, no artificial dyes or junk.`,
    `I'd love to send you a free pack to try. No strings attached -- if you like them, awesome. If not, no worries at all.`,
    `Would you be down to try them?`,
  ].join(' ');
}

// ---------------------------------------------------------------------------
// B) Mission Alignment
// ---------------------------------------------------------------------------
export function missionAlignment(influencer) {
  const name = displayName(influencer);
  const topic = influencer.recentTopic || '{{SPECIFIC_TOPIC}}';
  return [
    `Hi ${name}! Your content about ${topic} really resonates with what we're building at ${BRAND.name}.`,
    `We're a small American candy company fighting to prove you can make gummy bears without artificial dyes and still have them taste amazing.`,
    `We'd love to get your honest opinion -- can I send you a free bag?`,
  ].join(' ');
}

// ---------------------------------------------------------------------------
// C) Collaboration
// ---------------------------------------------------------------------------
export function collaboration(influencer) {
  const name = displayName(influencer);
  return [
    `${name} -- love your page! Quick question:`,
    `would you be interested in trying an American-made gummy bear that uses zero artificial dyes?`,
    `We're ${BRAND.name}, a small brand that's taking on the big candy companies.`,
    `We'd love to send you some for free and see what you think.`,
    `Totally cool if it's not your thing!`,
  ].join(' ');
}

// ---------------------------------------------------------------------------
// D) Exclusive / VIP
// ---------------------------------------------------------------------------
export function exclusiveVip(influencer) {
  const name = displayName(influencer);
  return [
    `Hey ${name}! We're hand-picking a small group of creators to be the first to try our new ${BRAND.productName}.`,
    `Made in the USA, no artificial colors, all natural flavors.`,
    `I think your audience would love the story. Can I send you a pack on us?`,
  ].join(' ');
}

// ---------------------------------------------------------------------------
// Template registry
// ---------------------------------------------------------------------------
export const TEMPLATES = {
  fan_first:          { id: 'fan_first',          label: 'Fan First',          fn: fanFirst },
  mission_alignment:  { id: 'mission_alignment',  label: 'Mission Alignment',  fn: missionAlignment },
  collaboration:      { id: 'collaboration',      label: 'Collaboration',      fn: collaboration },
  exclusive_vip:      { id: 'exclusive_vip',      label: 'Exclusive / VIP',    fn: exclusiveVip },
};

// ---------------------------------------------------------------------------
// Generate message for an influencer using a specific template
// ---------------------------------------------------------------------------
export function generateMessage(influencer, templateId = 'fan_first') {
  const template = TEMPLATES[templateId];
  if (!template) {
    throw new Error(`Unknown template: ${templateId}. Valid: ${Object.keys(TEMPLATES).join(', ')}`);
  }
  return {
    templateId: template.id,
    templateLabel: template.label,
    message: template.fn(influencer),
    generatedAt: new Date().toISOString(),
    influencerId: influencer.id,
    wordCount: template.fn(influencer).split(/\s+/).length,
  };
}

// ---------------------------------------------------------------------------
// Generate all template variations for an influencer (for preview)
// ---------------------------------------------------------------------------
export function generateAllVariations(influencer) {
  return Object.keys(TEMPLATES).map(id => generateMessage(influencer, id));
}

export default { TEMPLATES, generateMessage, generateAllVariations };
