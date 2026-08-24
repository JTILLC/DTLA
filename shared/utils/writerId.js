// shared/utils/writerId.js
//
// Which tab wrote this.
//
// A visit is watched live so that a change made somewhere else shows up here.
// The watcher's hard problem is not noticing changes — it is telling somebody
// ELSE's change from the echo of your own, because Firestore delivers both.
// `hasPendingWrites` covers the moment a write is in flight and nothing after
// it: the acknowledged copy comes back looking exactly like any other update,
// and the app was reading it as "this visit was changed on another device"
// while the only device involved was this one.
//
// So every write from this tab stamps its id, and the watcher ignores anything
// carrying it. Per TAB rather than per device or per login: two tabs open on
// one laptop really are two editors and should warn each other.
//
// Regenerated on every load, which is what makes it honest — a stamp that
// survived a reload would make this tab claim writes it did not make.
export const WRITER_ID = `w-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;

export default WRITER_ID;
