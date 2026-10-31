import { computeCriteriaHash } from '../domain/cacheKey';
import { interviewerRepository, type InterviewerLean } from '../repositories/interviewer.repository';
import { jobRepository, type JobLean } from '../repositories/job.repository';
import { slotRepository } from '../repositories/slot.repository';
import type { JobStatus } from '../types/enums';
import type { CreateJobInput, ReplaceInterviewersInput, UpdateJobInput } from '../types/job.schema';
import { ConflictError, NotFoundError } from '../utils/errors';
import { auditService, type AuditActor } from './audit.service';

export interface JobDto {
  id: string;
  title: string;
  description: string;
  requiredSkills: string[];
  preferredSkills: string[];
  criteria: Array<{ id: string; name: string; weight: number; description: string }>;
  capacity: number;
  waitlistSize: number;
  interviewMinutes: number;
  constraints: JobLean['constraints'];
  status: JobStatus;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InterviewerDto {
  id: string;
  name: string;
  timeZone: string;
  availability: Array<{ date: string; start: string; end: string }>;
}

const iso = (d: Date | undefined): string => (d ? new Date(d).toISOString() : '');

export function toJobDto(j: JobLean & { createdAt?: Date; updatedAt?: Date }): JobDto {
  return {
    id: String(j._id),
    title: j.title,
    description: j.description,
    requiredSkills: j.requiredSkills,
    preferredSkills: j.preferredSkills,
    criteria: j.criteria.map((c) => ({ id: c.id, name: c.name, weight: c.weight, description: c.description ?? '' })),
    capacity: j.capacity,
    waitlistSize: j.waitlistSize,
    interviewMinutes: j.interviewMinutes,
    constraints: j.constraints,
    status: j.status,
    ...(j.approvedAt ? { approvedAt: iso(j.approvedAt) } : {}),
    createdAt: iso(j.createdAt),
    updatedAt: iso(j.updatedAt),
  };
}

const toInterviewerDto = (i: InterviewerLean): InterviewerDto => ({
  id: String(i._id),
  name: i.name,
  timeZone: i.timeZone,
  availability: i.availability.map((a) => ({ date: a.date, start: a.start, end: a.end })),
});

/** Fields that change scores, shortlist maths or the slot grid. Locked once the shortlist is approved. */
const LOCKED_AFTER_APPROVAL = ['criteria', 'capacity', 'waitlistSize', 'interviewMinutes', 'constraints'] as const;
const APPROVED: readonly JobStatus[] = ['approved', 'scheduled', 'invited'];

async function mustFind(jobId: string): Promise<JobLean> {
  const job = await jobRepository.findById(jobId);
  if (!job) throw new NotFoundError('Job not found');
  return job;
}

async function list(page: number, limit: number, status?: JobStatus): Promise<{ items: JobDto[]; total: number }> {
  const { items, total } = await jobRepository.list(status ? { status } : {}, (page - 1) * limit, limit);
  return { items: items.map(toJobDto), total };
}

async function get(jobId: string): Promise<JobDto> {
  return toJobDto(await mustFind(jobId));
}

async function create(input: CreateJobInput, actor: AuditActor): Promise<JobDto> {
  const job = await jobRepository.create(input, actor.id, computeCriteriaHash(input.criteria));
  await auditService.append({ actor, action: 'job.create', entityType: 'job', entityId: String(job._id), jobId: String(job._id), newValue: { title: job.title, capacity: job.capacity, waitlistSize: job.waitlistSize } });
  return toJobDto(job);
}

async function update(jobId: string, patch: UpdateJobInput, actor: AuditActor): Promise<JobDto> {
  const job = await mustFind(jobId);
  const changed = Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined);
  if (APPROVED.includes(job.status)) {
    const locked = changed.filter((k) => (LOCKED_AFTER_APPROVAL as readonly string[]).includes(k));
    if (locked.length > 0) throw new ConflictError(`These fields cannot change after approval: ${locked.join(', ')}`);
  }
  const set: Record<string, unknown> = { ...patch };
  if (patch.criteria) set['criteriaHash'] = computeCriteriaHash(patch.criteria);
  const updated = await jobRepository.update(jobId, set);
  if (!updated) throw new NotFoundError('Job not found');
  await auditService.append({
    actor, action: 'job.update', entityType: 'job', entityId: jobId, jobId,
    oldValue: { status: job.status, title: job.title }, newValue: { status: updated.status, title: updated.title }, payload: { fields: changed },
  });
  return toJobDto(updated);
}

async function getInterviewers(jobId: string): Promise<InterviewerDto[]> {
  await mustFind(jobId);
  return (await interviewerRepository.findByJob(jobId)).map(toInterviewerDto);
}

/** PUT replaces the whole list. Refused once slots exist, because slots reference interviewer ids. */
async function replaceInterviewers(jobId: string, input: ReplaceInterviewersInput, actor: AuditActor): Promise<InterviewerDto[]> {
  const job = await mustFind(jobId);
  if (APPROVED.includes(job.status) && (await slotRepository.countForJob(jobId)) > 0) {
    throw new ConflictError('Interviewers cannot be replaced after a schedule exists. Mark an interviewer unavailable instead.');
  }
  const saved = await interviewerRepository.replaceForJob(jobId, input.interviewers);
  await auditService.append({ actor, action: 'job.update', entityType: 'job', entityId: jobId, jobId, payload: { fields: ['interviewers'], count: saved.length } });
  return saved.map(toInterviewerDto);
}

export const jobService = { list, get, create, update, getInterviewers, replaceInterviewers };
