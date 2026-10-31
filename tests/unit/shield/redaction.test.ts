import { describe, expect, it } from 'vitest';
import { detectNameTokens, redact } from '../../../src/domain/redaction';

const RESUME = [
  'Priya Sharma',
  'priya.sharma@example.com | +91 98765 43210',
  'https://github.com/priya-codes  linkedin.com/in/priyasharma  @priya_codes',
  'Address: 12, MG Road, Shimla 171001',
  'Date of Birth: 14 March 1998',
  'Age: 29',
  'She is a backend engineer. Her work improved his team results.',
  'Experience',
  'Backend developer at Acme Labs, 2021 - 2024',
  'Built Node.js services with MongoDB.',
  'Education',
  'B.Tech in Computer Science, Himachal Pradesh University, 2019',
  'Clubs',
  'Rotary club volunteer',
  'Skills',
  'Node.js, MongoDB, Redis',
].join('\n');

describe('blind redaction', () => {
  const { redactedText, removedCategories } = redact(RESUME, 'Priya_Sharma_Resume.pdf');

  it('removes the name everywhere', () => {
    expect(redactedText).not.toMatch(/Priya|Sharma/i);
    expect(redactedText).toContain('[CANDIDATE]');
  });
  it('removes email, phone, urls and handles', () => {
    expect(redactedText).not.toContain('@example.com');
    expect(redactedText).not.toContain('98765');
    expect(redactedText).not.toMatch(/github\.com|linkedin\.com/);
    expect(redactedText).not.toContain('@priya_codes');
    for (const t of ['[EMAIL]', '[PHONE]', '[URL]', '[HANDLE]']) expect(redactedText).toContain(t);
  });
  it('removes address and pin', () => {
    expect(redactedText).not.toMatch(/MG Road|171001/);
    expect(redactedText).toContain('[ADDRESS]');
  });
  it('removes date of birth and age', () => {
    expect(redactedText).not.toContain('1998');
    expect(redactedText).not.toMatch(/Age:\s*29/);
    expect(redactedText).toContain('[DOB]');
    expect(redactedText).toContain('[AGE]');
  });
  it('removes gender words', () => {
    expect(redactedText).not.toMatch(/\b(she|her|his|he)\b/i);
    expect(redactedText).toContain('[GENDER]');
  });
  it('replaces school with [INSTITUTION] and drops graduation year but keeps degree level and field', () => {
    expect(redactedText).not.toMatch(/Himachal|2019/);
    expect(redactedText).toContain('[INSTITUTION]');
    expect(redactedText).toContain('B.Tech');
    expect(redactedText).toContain('Computer Science');
  });
  it('removes club and affiliation content', () => {
    expect(redactedText).not.toContain('Rotary');
    expect(redactedText).toContain('[AFFILIATION REMOVED]');
  });
  it('KEEPS job dates and skills needed for scoring', () => {
    expect(redactedText).toContain('2021 - 2024');
    expect(redactedText).toContain('Node.js, MongoDB, Redis');
    expect(redactedText).toContain('Built Node.js services with MongoDB.');
  });
  it('reports every removed category', () => {
    expect(removedCategories).toEqual(
      expect.arrayContaining(['name', 'email', 'phone', 'url', 'handle', 'address', 'dob', 'age', 'gender', 'school', 'graduation_year', 'affiliation']),
    );
  });
});

describe('redaction properties', () => {
  it('is deterministic', () => {
    expect(redact(RESUME, 'x.pdf')).toEqual(redact(RESUME, 'x.pdf'));
  });

  it('two resumes differing only in name and gender redact to identical text (swap-test basis)', () => {
    const a = 'Priya Sharma\npriya@example.com\nShe built scalable APIs.\nSkills\nNode.js';
    const b = 'Rahul Verma\nrahul@example.com\nHe built scalable APIs.\nSkills\nNode.js';
    expect(redact(a, 'resume.pdf').redactedText).toBe(redact(b, 'resume.pdf').redactedText);
  });

  it('clean text with no personal data is unchanged (false-positive guard)', () => {
    const clean = 'Skills\nNode.js, MongoDB\nBuilt APIs with 5 years of experience.';
    const res = redact(clean, 'resume.pdf');
    expect(res.redactedText).toBe(clean);
    expect(res.removedCategories).toEqual([]);
  });

  it('detects name tokens from header and file name but ignores stop words', () => {
    const tokens = detectNameTokens('Priya Sharma\nSkills', 'Priya_Sharma_Resume_final.pdf');
    expect(tokens).toEqual(expect.arrayContaining(['Priya', 'Sharma']));
    expect(tokens.map((t) => t.toLowerCase())).not.toContain('resume');
    expect(tokens.map((t) => t.toLowerCase())).not.toContain('final');
  });

  it('does not treat a section heading as a name', () => {
    expect(detectNameTokens('Skills\nNode.js', 'resume.pdf')).toEqual([]);
  });
});
