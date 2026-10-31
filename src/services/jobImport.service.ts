import { DateTime } from 'luxon';
import { cleanSkills, normalizeCriteria } from '../domain/jobImport';
import { isUnreadable, normalizeText } from '../domain/text';
import { getLlmClient } from '../integrations/llm';
import { buildJobImportPrompt, PROMPT_IDS } from '../integrations/llm/prompts';
import { jobImportSchema } from '../integrations/llm/schemas';
import type { CreateJobInput } from '../types/job.schema';
import { LlmSchemaError } from '../integrations/llm/types';
import { UploadRejectedError, ValidationError } from '../utils/errors';
import type { AuditActor } from './audit.service';
import { extractDocx } from './ingestion/extractDocx';
import { extractPdf } from './ingestion/extractPdf';
import { validateUpload } from './ingestion/validate';
import { jobService, type JobDto } from './job.service';
import { meetingService } from './meeting.service';

export interface JobImportResult {
  job: JobDto;
  /** What the AI found, so HR can see what was filled in. */
  summary: { requiredSkills: number; preferredSkills: number; criteria: number; openingsFound: boolean };
}

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.round(n)));

function validZone(zone: string | undefined): string {
  const z = zone ?? 'Asia/Kolkata';
  return DateTime.now().setZone(z).isValid ? z : 'Asia/Kolkata';
}

/**
 * Reads a job description document (PDF or DOCX), asks the AI to pull out the role, skills and scoring
 * criteria, and creates the opening straight away with the interview hours and Meet link HR already saved.
 * HR can edit anything afterwards. The scheduling fields are not in a job document, so they come from settings.
 */
async function importFromDocument(
  file: { originalname: string; buffer: Buffer },
  actor: AuditActor,
  timeZone?: string,
): Promise<JobImportResult> {
  const valid = await validateUpload(file.originalname, file.buffer);
  if (!valid.ok) throw new UploadRejectedError(valid.reason);

  let raw = '';
  try {
    raw = valid.fileType === 'pdf' ? (await extractPdf(file.buffer)).text : (await extractDocx(file.buffer)).text;
  } catch {
    throw new UploadRejectedError('This file is damaged and could not be read.');
  }
  const text = normalizeText(raw);
  if (isUnreadable(text)) {
    throw new UploadRejectedError('No readable text was found in this document. Upload a text PDF or a DOCX file.');
  }

  const prompt = buildJobImportPrompt(text);
  let out;
  try {
    out = (await getLlmClient().generateJson(PROMPT_IDS.jobImport, prompt.system, prompt.user, jobImportSchema)).data;
  } catch (err) {
    if (err instanceof LlmSchemaError) {
      throw new ValidationError('The AI could not read this document clearly. Try again or create the opening by hand.');
    }
    throw err;
  }

  const fileTitle = file.originalname.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  const title = (out.title || fileTitle).slice(0, 160);
  const description = (out.description.length >= 10 ? out.description : text.slice(0, 1500)).slice(0, 10_000);

  const criteria = normalizeCriteria(out.criteria);
  let required = cleanSkills(out.requiredSkills, 40);
  const preferred = cleanSkills(out.preferredSkills, 40, new Set(required.map((s) => s.toLowerCase())));
  if (required.length === 0) required = cleanSkills(preferred.length > 0 ? preferred.slice(0, 5) : criteria.slice(0, 3).map((c) => c.name), 5);
  if (required.length === 0) throw new ValidationError('No skills were found in this document. Create the opening by hand.');

  const settings = await meetingService.getSettings(actor.id);
  const zone = validZone(timeZone ?? settings.timeZone);
  const first = DateTime.now().setZone(zone).plus({ days: 1 }).startOf('day');
  const dates = Array.from({ length: 5 }, (_, i) => first.plus({ days: i }).toFormat('yyyy-MM-dd'));
  const meetingLink = /^https:\/\/\S+$/i.test(settings.meetLink) ? settings.meetLink : 'https://meet.google.com/new';

  const input: CreateJobInput = {
    title,
    description,
    requiredSkills: required,
    preferredSkills: preferred,
    criteria,
    capacity: clamp(out.openings ?? 5, 1, 200),
    waitlistSize: 3,
    interviewMinutes: clamp(out.interviewMinutes ?? settings.slotMinutes ?? 30, 10, 240),
    constraints: {
      dates,
      dailyStart: settings.windowStart,
      dailyEnd: settings.windowEnd,
      breaks: [],
      timeZone: zone,
      format: 'virtual',
      meetingLink,
    },
  };

  const job = await jobService.create(input, actor);
  return {
    job,
    summary: { requiredSkills: required.length, preferredSkills: preferred.length, criteria: criteria.length, openingsFound: out.openings !== undefined },
  };
}

export const jobImportService = { importFromDocument };
