// The lesson index (written in WP0, never edited by a writer): the six courses over their fixed
// const names, the merged program table, and the lookups the shell uses.
// A course file that is not built yet leaves its name undefined; the typeof guards keep the page
// alive (the one-scope build would otherwise stop at the first ReferenceError).
const learnList = v => (Array.isArray(v) ? v : []);
// The 8086 course: the letter lesson (its own file while the other lessons are written) and the
// rest of l8086.js, in order of n, one lesson per n (the letter file wins a duplicate).
const LEARN_LESSONS = (() => {
  const merge = (...lists) => {
    const byN = new Map();
    for (const L of lists) for (const x of L) if (x && !byN.has(x.n)) byN.set(x.n, x);
    return [...byN.values()].sort((a, b) => a.n - b.n);
  };
  return {
    '8086': merge(learnList(typeof LESSONS_8086_LETTER !== 'undefined' ? LESSONS_8086_LETTER : null), learnList(typeof LESSONS_8086 !== 'undefined' ? LESSONS_8086 : null)),
    '80286': merge(learnList(typeof LESSONS_80286 !== 'undefined' ? LESSONS_80286 : null)),
    '80386': merge(learnList(typeof LESSONS_80386 !== 'undefined' ? LESSONS_80386 : null)),
    '80486': merge(learnList(typeof LESSONS_80486 !== 'undefined' ? LESSONS_80486 : null)),
    '80586': merge(learnList(typeof LESSONS_80586 !== 'undefined' ? LESSONS_80586 : null)),
    '80686': merge(learnList(typeof LESSONS_80686 !== 'undefined' ? LESSONS_80686 : null)),
  };
})();
const LEARN_PROGRAMS = Object.assign({},
  typeof LEARN_PROGRAMS_8086 !== 'undefined' ? LEARN_PROGRAMS_8086 : {},
  typeof LEARN_PROGRAMS_LATER !== 'undefined' ? LEARN_PROGRAMS_LATER : {});
function learnLessonOf(model, id) {
  const list = LEARN_LESSONS[model] || [];
  return list.find(x => x.id === id) || null;
}
