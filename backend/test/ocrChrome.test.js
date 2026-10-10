// A chat screenshot's own label and timestamp must not count as the specific
// detail that makes a message checkable.
const test = require('node:test');
const assert = require('node:assert');
const { __test: { stripMessageChrome } } = require('../utils/ocr');
const { assessCheckability } = require('../agents/checkability');

test('a forwarded exhortation is refused even with the timestamp in the screenshot', () => {
  const read = 'Forwarded many times\nWake up! They are hiding the truth from all of you. Share this with everyone before it is deleted. Do not let them silence us. Forward this to every group now!\n10 Oct 2026, 7:03 am';
  const text = stripMessageChrome(read);
  assert.ok(!/2026|7:03|Forwarded/.test(text));
  assert.strictEqual(assessCheckability(text).checkable, false);
});

test('dates inside the message itself are kept', () => {
  const text = stripMessageChrome('Forwarded\nTVK won the Dharapuram by-election on 9 October 2026.\n9 Oct 2026, 6:42 pm');
  assert.strictEqual(text, 'TVK won the Dharapuram by-election on 9 October 2026.');
});
