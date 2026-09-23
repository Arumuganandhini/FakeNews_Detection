// What a public endpoint is allowed to hand to a stranger.
//
// GET /api/article-feedback/all/:articleId takes no token by design: anyone
// reading an article can see what other readers said about it. It populated
// the reviewer's email, and the article page printed that address beside the
// review — so every reader's email was readable by anyone who knew an article
// URL. The shape of this response is therefore worth pinning down.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const controller = fs.readFileSync(
  path.join(__dirname, '..', 'controllers', 'articleFeedbackController.js'), 'utf8'
);

const publicHandler = controller.slice(controller.indexOf('exports.getAllArticleFeedbacks'));

test('the public feedback route does not populate the reviewer email', () => {
  assert.ok(
    !/populate\(\s*['"]userId['"]\s*,\s*['"][^'"]*email/.test(publicHandler),
    'an unauthenticated caller must not be handed reviewer email addresses'
  );
});

test('the public feedback route populates a display name instead', () => {
  assert.match(publicHandler, /populate\(\s*['"]userId['"]\s*,\s*['"]name['"]\s*\)/);
});

// The page has to render something, and whatever it renders must come from
// the field above rather than from an address.
test('the article page shows a name, not an address', () => {
  const page = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'ArticlePage.js'), 'utf8'
  );
  assert.ok(!/feedback\.userId\?\.email/.test(page), 'the page must not print a reviewer email');
  assert.match(page, /feedback\.userId\?\.name/);
});
