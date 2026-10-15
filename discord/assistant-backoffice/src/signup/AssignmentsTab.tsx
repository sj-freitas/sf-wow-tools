import { useState } from 'react';
import { InlineSpinner } from '../Loading';
import type { Guild } from '../types';
import { useConfirm } from '../useConfirm';
import { AssignmentEditor } from './AssignmentEditor';
import { AssignmentLineView } from './AssignmentLineView';
import { CopyAssignmentsDrawer } from './CopyAssignmentsDrawer';
import { scopeHeading } from './assignmentText';
import { errorText } from './labels';
import {
  assignmentImageUrl,
  deleteAssignment,
  postAssignments,
  removeAssignmentPosts,
  reorderAssignments,
  type Assignment,
  type SignupEvent,
} from './signupApi';

/**
 * The event's assignments, in the order they are posted (everyone's, then per raid, then per
 * boss). Everyone sees them; organisers write, order, post and remove them.
 */
export function AssignmentsTab({
  guild,
  event,
  onChanged,
}: {
  guild: Guild;
  event: SignupEvent;
  onChanged: () => Promise<unknown>;
}) {
  const organize = event.permissions.canOrganize;
  const [editing, setEditing] = useState<Assignment | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  const assignments = event.assignments;
  const posted = assignments.filter((a) => a.postUrl).length;

  const run = (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    action()
      .then(onChanged)
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setBusy(false));
  };

  /** Swaps with the neighbour of the same kind (the order across kinds is fixed). */
  const move = (index: number, direction: -1 | 1) => {
    const ids = assignments.map((a) => a.id);
    let other = index + direction;
    while (other >= 0 && other < assignments.length) {
      if (assignments[other].scope === assignments[index].scope) break;
      other += direction;
    }
    if (other < 0 || other >= assignments.length) return;
    [ids[index], ids[other]] = [ids[other], ids[index]];
    run(() => reorderAssignments(guild.id, event.id, ids));
  };

  return (
    <div className="tasks">
      {dialog}
      {organize && (
        <div className="tasks-head">
          <span className="muted">
            Each assignment is its own message in the event’s channel. While they are posted, saving
            one edits its message.
          </span>
          <div className="settings-actions">
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => setEditing('new')}
              disabled={editing !== null}
            >
              + Assignment
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setCopying(true)}
              disabled={editing !== null}
            >
              Copy from another event
            </button>
            {posted < assignments.length && (
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy}
                onClick={() => run(() => postAssignments(guild.id, event.id))}
              >
                {busy ? (
                  <InlineSpinner label="Posting…" />
                ) : posted === 0 ? (
                  'Post to Discord'
                ) : (
                  `Post the ${assignments.length - posted} not posted`
                )}
              </button>
            )}
            {posted > 0 && (
              <button
                type="button"
                className="btn btn-sm btn-danger"
                disabled={busy}
                onClick={() =>
                  void confirm({
                    title: 'Remove the assignments from Discord?',
                    message:
                      'Every assignment message is deleted. The assignments stay here and can be posted again.',
                    confirmLabel: 'Remove messages',
                    danger: true,
                  }).then((ok) => ok && run(() => removeAssignmentPosts(guild.id, event.id)))
                }
              >
                Remove from Discord
              </button>
            )}
          </div>
        </div>
      )}
      {error && <p className="status-error">{error}</p>}
      {notice && <p className="muted">{notice}</p>}
      {copying && (
        <CopyAssignmentsDrawer
          guild={guild}
          event={event}
          onClose={() => setCopying(false)}
          onCopied={(message) => {
            setNotice(message);
            void onChanged();
          }}
        />
      )}

      {editing === 'new' && (
        <AssignmentEditor
          guild={guild}
          event={event}
          assignment={null}
          onDone={(saved) => {
            setEditing(null);
            if (saved) void onChanged();
          }}
        />
      )}

      {assignments.length === 0
        ? editing === null && (
            <p className="empty">
              No assignments yet.
              {organize && ' Give some of the signed-up players a task: heal someone, tank a mark…'}
            </p>
          )
        : assignments.map((assignment, index) =>
            editing !== 'new' && editing?.id === assignment.id ? (
              <AssignmentEditor
                key={assignment.id}
                guild={guild}
                event={event}
                assignment={assignment}
                onDone={(saved) => {
                  setEditing(null);
                  if (saved) void onChanged();
                }}
              />
            ) : (
              <article key={assignment.id} className="task-card assignment-card">
                <div className="assignment-head">
                  <div>
                    <span className="muted">{scopeHeading(assignment)}</span>
                    <h4>{assignment.title}</h4>
                  </div>
                  {assignment.postUrl ? (
                    <a
                      className="badge badge-live"
                      href={assignment.postUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Posted
                    </a>
                  ) : (
                    <span className="badge">Not posted</span>
                  )}
                </div>
                {assignment.lines.length > 0 && (
                  <ul className="assignment-lines">
                    {assignment.lines.map((line, i) => (
                      <li key={i}>
                        <AssignmentLineView
                          line={line}
                          entries={event.entries}
                          gameVersion={guild.gameVersion}
                        />
                      </li>
                    ))}
                  </ul>
                )}
                {assignment.imageIds.length > 0 && (
                  <div className="assignment-images">
                    {assignment.imageIds.map((id) => (
                      <a
                        key={id}
                        href={assignmentImageUrl(guild.id, event.id, id)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <img src={assignmentImageUrl(guild.id, event.id, id)} alt="" />
                      </a>
                    ))}
                  </div>
                )}
                {organize && (
                  <div className="settings-actions">
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={editing !== null}
                      onClick={() => setEditing(assignment)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      title="Move up"
                      aria-label="Move up"
                      disabled={busy}
                      onClick={() => move(index, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      title="Move down"
                      aria-label="Move down"
                      disabled={busy}
                      onClick={() => move(index, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      disabled={busy}
                      onClick={() =>
                        void confirm({
                          title: `Delete “${assignment.title}”?`,
                          message: assignment.postUrl
                            ? 'The assignment and its message in Discord are deleted.'
                            : 'The assignment is deleted.',
                          confirmLabel: 'Delete',
                          danger: true,
                        }).then(
                          (ok) =>
                            ok && run(() => deleteAssignment(guild.id, event.id, assignment.id)),
                        )
                      }
                    >
                      Delete
                    </button>
                  </div>
                )}
              </article>
            ),
          )}
    </div>
  );
}
