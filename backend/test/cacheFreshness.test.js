// A URL is not a stable name for a piece of writing.
//
// Both caches were keyed on the article URL alone, with a 14-day life. A
// markets wrap, a live blog or a developing story keeps its address and
// replaces its contents — so the app served a summary of whatever used to live
// there. Seen on screen: a page headlined "Nasdaq rose to a new all-time
// intraday high" above a summary, written nine days earlier, of a sell-off.
// Two different articles, stacked as one.
const test = require('node:test');
const assert = require('node:assert');
const { fingerprintText } = require('../utils/articleText');

const TUESDAY = 'The Nasdaq Composite rose to a new all-time intraday high and closed at a record on Tuesday.';
const WEDNESDAY = 'U.S. equities declined on Wednesday, with the S&P 500 falling 0.75% and the Nasdaq dropping 1.13%.';

test('the same text fingerprints the same way', () => {
  assert.equal(fingerprintText(TUESDAY), fingerprintText(TUESDAY));
});

test('a rewritten story does not match the version that was summarised', () => {
  assert.notEqual(fingerprintText(TUESDAY), fingerprintText(WEDNESDAY));
});

test('an empty source is still fingerprintable, so no entry is keyless', () => {
  assert.equal(typeof fingerprintText(''), 'string');
  assert.ok(fingerprintText('').length > 0);
});

// The cache decision itself, as the route makes it: an entry written before
// fingerprinting existed has none and stays usable, one that matches is a hit,
// one that differs is not.
const isUsable = (hit, sourcePrint) => Boolean(hit) && (!hit.sourcePrint || hit.sourcePrint === sourcePrint);

test('an entry matching the current text is served', () => {
  assert.equal(isUsable({ sourcePrint: fingerprintText(TUESDAY) }, fingerprintText(TUESDAY)), true);
});

test('an entry built from text the publisher has replaced is not served', () => {
  assert.equal(isUsable({ sourcePrint: fingerprintText(WEDNESDAY) }, fingerprintText(TUESDAY)), false);
});

test('an entry from before fingerprinting is still served', () => {
  assert.equal(isUsable({ summary: 'older entry' }, fingerprintText(TUESDAY)), true);
});
