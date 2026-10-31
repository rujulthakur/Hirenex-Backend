/** Demo job definition. Pure data. Criteria weights sum to 100. */
export const DEMO_JOB_TITLE = 'Backend Engineer (Demo)';
export const DEMO_TAG = 'synthetic-demo';

export const DEMO_CRITERIA = [
  { id: 'backend', name: 'Backend development (Node.js, TypeScript)', weight: 30, description: 'Production Node.js and TypeScript services.' },
  { id: 'databases', name: 'Databases (MongoDB)', weight: 25, description: 'Schema design, indexing and query tuning.' },
  { id: 'api', name: 'API design (REST)', weight: 20, description: 'Versioned, documented REST APIs.' },
  { id: 'devops', name: 'DevOps (Docker, CI/CD, cloud)', weight: 15, description: 'Containers, pipelines and deployment.' },
  { id: 'teamwork', name: 'Communication and mentoring', weight: 10, description: 'Reviews, mentoring, collaboration.' },
] as const;

export const DEMO_REQUIRED_SKILLS = ['Node.js', 'TypeScript', 'MongoDB', 'REST APIs', 'Docker'] as const;
export const DEMO_PREFERRED_SKILLS = ['Redis', 'AWS', 'CI/CD'] as const;

export const DEMO_CAPACITY = 8;
export const DEMO_WAITLIST = 4;
export const DEMO_INTERVIEW_MINUTES = 30;
export const DEMO_TIME_ZONE = 'Asia/Kolkata';

export interface DemoInterviewer {
  name: string;
  timeZone: string;
  /** Availability windows in the interviewer's OWN zone, relative day index into the job dates. */
  windows: Array<{ day: 0 | 1; start: string; end: string }>;
}

/** Three interviewers in three different zones; every window sits inside the job hours when converted. */
export const DEMO_INTERVIEWERS: readonly DemoInterviewer[] = [
  { name: 'Asha Menon (Kolkata)', timeZone: 'Asia/Kolkata', windows: [{ day: 0, start: '10:00', end: '17:00' }, { day: 1, start: '10:00', end: '17:00' }] },
  { name: 'Marcus Lee (Singapore)', timeZone: 'Asia/Singapore', windows: [{ day: 0, start: '12:30', end: '19:30' }, { day: 1, start: '12:30', end: '19:30' }] },
  { name: 'Elena Petrova (Dubai)', timeZone: 'Asia/Dubai', windows: [{ day: 0, start: '08:30', end: '15:30' }, { day: 1, start: '08:30', end: '15:30' }] },
];

export const DEMO_DAILY_START = '10:00';
export const DEMO_DAILY_END = '17:00';
export const DEMO_BREAKS = [{ start: '13:00', end: '14:00' }] as const;
export const DEMO_MEETING_LINK = 'https://meet.example.test/trusthire-demo';

/** Two consecutive weekdays starting from the next Monday after `now` (UTC based, deterministic for a given day). */
export function demoDates(now: Date): [string, string] {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  do {
    d.setUTCDate(d.getUTCDate() + 1);
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  const first = d.toISOString().slice(0, 10);
  do {
    d.setUTCDate(d.getUTCDate() + 1);
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return [first, d.toISOString().slice(0, 10)];
}

export const DEMO_JOB_DESCRIPTION =
  'We are hiring a Backend Engineer to build and run Node.js and TypeScript services backed by MongoDB. ' +
  'You will design versioned REST APIs, ship containerised services with Docker and CI/CD, and mentor teammates. ' +
  'All candidates and data in this demo are synthetic.';
