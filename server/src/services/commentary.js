// Commentary feed and scorer edits. Generated text comes from engine/commentary.js; an edit only
// replaces the sentence of one delivery and never touches the scoring log.

import { CommentaryEdit } from '../models/index.js';
import { notFound } from '../utils/errors.js';
import { audit } from './audit.js';
import { commentary, commentaryEntry, getRuntime, withMatchLock } from './runtime.js';
import { publishCommentary } from '../realtime/hub.js';

/** Newest first. `before` = only deliveries with seq < before (paging back through a match). */
export async function getCommentary(matchId, { limit = 30, before } = {}) {
  const rt = await getRuntime(matchId);
  const all = commentary(rt);
  const list = [];
  for (let i = all.length - 1; i >= 0 && list.length < limit; i--) {
    if (before === undefined || all[i].seq < before) list.push(all[i]);
  }
  return { matchId: rt.id, version: rt.lastSeq, total: all.length, entries: list };
}

/** Set (or with empty text, clear) the scorer's wording for one delivery. */
export async function editCommentary(matchId, seq, text, user) {
  return withMatchLock(matchId, async () => {
    const rt = await getRuntime(matchId);
    const before = commentaryEntry(rt, seq);
    if (!before) throw notFound('Delivery');
    const clean = (text || '').trim();
    if (clean) {
      await CommentaryEdit.updateOne(
        { match: rt.match._id, seq },
        { $set: { text: clean, at: new Date(), user: user ? { id: String(user.id), username: user.username } : undefined } },
        { upsert: true },
      );
      rt.commentaryEdits.set(seq, clean);
    } else {
      await CommentaryEdit.deleteOne({ match: rt.match._id, seq });
      rt.commentaryEdits.delete(seq);
    }
    delete rt.views.commentary;
    const entry = commentaryEntry(rt, seq);
    await audit(user, clean ? 'commentary.edit' : 'commentary.reset', 'match', rt.id, { seq, from: before.text, to: entry.text });
    publishCommentary(rt, entry);
    return entry;
  });
}
