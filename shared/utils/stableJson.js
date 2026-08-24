// shared/utils/stableJson.js
//
// JSON with its keys in a fixed order.
//
// Two copies of a visit are compared as strings to decide whether anything
// actually changed. JSON.stringify writes keys in insertion order, and the copy
// that has been to Firestore and back does not have the order it left with —
// so the same visit, compared with itself, could come out different and the app
// would announce a change nobody made.
//
// Sorting the keys makes the comparison about content, which is the only thing
// it was ever meant to be about.
const sortValue = (value) => {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    // Dates and anything else with a toJSON are left to it.
    if (typeof value.toJSON === 'function') return value;
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = sortValue(value[key]);
      return out;
    }, {});
  }
  return value;
};

export const stableStringify = (value) => JSON.stringify(sortValue(value));

export default stableStringify;
