import { Navigate, Route, Routes } from 'react-router-dom';
import { guildPath } from '../guildPath';
import type { Guild } from '../types';
import { EventFormPage } from './EventFormPage';
import { EventPage } from './EventPage';
import { EventsPage } from './EventsPage';
import './signup.css';

/**
 * Event sign-ups, under a guild's `/signup` (everything of the feature lives in this folder):
 *
 *   /signup                  upcoming and past events, and the sign-up settings
 *   /signup/create           new event                      Officers and EventCreators
 *   /signup/:eventId         the event: sign-ups (?tab=signups), raid setup (?tab=setup),
 *                            assignments (?tab=assignments), who hasn't answered (?tab=missing)
 *   /signup/:eventId/edit    the same (older links): the event's page has the form
 */
export function SignupRoutes({ guild, timezone }: { guild: Guild; timezone: string }) {
  return (
    <Routes>
      <Route index element={<EventsPage guild={guild} timezone={timezone} />} />
      <Route path="create" element={<EventFormPage guild={guild} serverTimezone={timezone} />} />
      <Route path=":eventId" element={<EventPage guild={guild} />} />
      {/* Editing happens on the event's page, always open for its organisers. */}
      <Route path=":eventId/edit" element={<EventPage guild={guild} />} />
      <Route path="*" element={<Navigate to={guildPath(guild, 'signup')} replace />} />
    </Routes>
  );
}
