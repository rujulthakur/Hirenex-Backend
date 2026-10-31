import { BULLETS, type ResumeSpec } from './resumeSpecs';

/** PURE. Turns a spec into plain structured content shared by the PDF and DOCX renderers. */
export interface ResumeContent {
  name: string;
  contact: string;
  summary: string;
  skillsLine: string;
  experienceHeading: string;
  bullets: string[];
  education: string;
  extras: string[];
}

export const emailFor = (spec: ResumeSpec): string => {
  const slug = spec.name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '');
  return `${slug}@example.test`;
};

export function buildContent(spec: ResumeSpec): ResumeContent {
  const P = spec.pronoun === 'she' ? 'She' : 'He';
  const poss = spec.pronoun === 'she' ? 'her' : 'his';
  const bullets: string[] = spec.bullets.map((k) => BULLETS[k]);
  if (spec.alteredBullet) {
    const idx = bullets.findIndex((b) => b === BULLETS.rest);
    if (idx >= 0) bullets[idx] = spec.alteredBullet;
  }
  const extras: string[] = [];
  if (spec.visibleExtra) extras.push(spec.visibleExtra);
  if (spec.keywordBlock) extras.push(`Keywords: ${spec.keywordBlock}`);
  if (spec.kind === 'swap') extras.push(`${spec.honorific} ${spec.name.split(' ')[1] ?? ''} is a member of the university coding club.`);
  return {
    name: spec.name,
    contact: `${emailFor(spec)} | ${spec.phone} | ${spec.city}`,
    summary: `${spec.title} with ${spec.years} years of experience. ${P} builds reliable backend systems and shares ${poss} knowledge with the team.`,
    skillsLine: spec.skills.length > 0 ? `Skills: ${spec.skills.join(', ')}` : 'Skills: see experience',
    experienceHeading: `${spec.title}, ${spec.company} (${spec.years} years)`,
    bullets,
    education: `B.Tech Computer Science, ${spec.school}, graduated ${spec.gradYear}`,
    extras,
  };
}
