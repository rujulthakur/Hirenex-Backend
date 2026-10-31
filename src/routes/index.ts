import { Router } from 'express';
import { authRouter } from './auth.routes';
import { candidateCrudRouter, jobCandidateRouter } from './candidate.routes';
import { jobRouter } from './job.routes';
import { demoRouter } from './demo.routes';
import { healthRouter } from './health.routes';
import { jobResumeRouter } from './resume.routes';
import { candidateFairnessRouter, hrAnalyticsRouter, jobAnalyticsRouter, notificationRouter } from './fairness.routes';
import { inviteRouter, jobInviteRouter, portalRouter } from './invite.routes';
import { jobRepairRouter, portalRepairRouter } from './repair.routes';
import { jobMeetingRouter, meetingRouter, settingsRouter } from './meeting.routes';
import { jobScheduleRouter } from './schedule.routes';
import { candidateScoringRouter, jobScoringRouter } from './scoring.routes';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/jobs', jobRouter);
apiRouter.use('/jobs', jobCandidateRouter);
apiRouter.use('/jobs', jobResumeRouter);
apiRouter.use('/jobs', jobScoringRouter);
apiRouter.use('/jobs', jobScheduleRouter);
apiRouter.use('/jobs', jobRepairRouter);
apiRouter.use('/jobs', jobInviteRouter);
apiRouter.use('/jobs', jobMeetingRouter);
apiRouter.use('/meetings', meetingRouter);
apiRouter.use('/settings', settingsRouter);
apiRouter.use('/invites', inviteRouter);
apiRouter.use('/portal', portalRouter);
apiRouter.use('/portal', portalRepairRouter);
apiRouter.use('/candidates', candidateScoringRouter);
apiRouter.use('/candidates', candidateCrudRouter);
apiRouter.use('/candidates', candidateFairnessRouter);
apiRouter.use('/jobs', jobAnalyticsRouter);
apiRouter.use('/analytics', hrAnalyticsRouter);
apiRouter.use('/notifications', notificationRouter);
apiRouter.use('/demo', demoRouter);
// Later prompts mount: /auth, /jobs, /candidates, /portal, /audit, /demo, /notifications ...
