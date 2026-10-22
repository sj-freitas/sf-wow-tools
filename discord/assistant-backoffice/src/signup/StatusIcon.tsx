import type { ReactNode } from 'react';
import { CheckCircleIcon, ClockIcon, HelpCircleIcon, XCircleIcon } from '../Icons';
import type { SignupStatus } from './signupApi';

const ICONS: Record<SignupStatus, ReactNode> = {
  AVAILABLE: <CheckCircleIcon />,
  LATE: <ClockIcon />,
  TENTATIVE: <HelpCircleIcon />,
  ABSENT: <XCircleIcon />,
};

/** A sign-up status as a line icon in its colour (the website's; Discord posts keep their emojis). */
export function StatusIcon({ status }: { status: SignupStatus }) {
  return <span className={`status-icon status-icon-${status.toLowerCase()}`}>{ICONS[status]}</span>;
}
