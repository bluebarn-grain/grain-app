// Office password, sign-in tokens, lockout, scale key limits.
const assert = require('assert');
const { loadBackend, testSheet } = require('./mock-gas.js');
const be = loadBackend(testSheet(), { SHEET_ID: 'x', API_KEY: 'k', SCALE_KEY: 'sk' });
const call = b => be.call({ key: 'k', ...b });
let n = 0; const t = (name, f) => { f(); n++; console.log('ok - ' + name); };

t('no password yet: office works without sign-in', () => {
  assert.strictEqual(call({ action: 'ping' }).hasPassword, false);
  assert.ok(call({ action: 'officeData' }).ok);
});
let tok;
t('set a password → signed in; too short refused', () => {
  assert.match(call({ action: 'setPassword', newPassword: 'abc' }).error, /6 characters/);
  const j = call({ action: 'setPassword', newPassword: 'bluebarn26' }); assert.ok(j.token); tok = j.token;
  assert.strictEqual(call({ action: 'ping', token: tok }).signedIn, true);
});
t('office needs the sign-in now', () => {
  const j = call({ action: 'officeData' }); assert.strictEqual(j.signin, true);
  assert.ok(call({ action: 'officeData', token: tok }).ok);
  assert.ok(call({ action: 'lists' }).ok, 'scale lists still open');
  assert.ok(call({ action: 'saveTickets', tickets: [] }).ok, 'tickets still sync');
});
t('changing the password needs the old one and a sign-in', () => {
  assert.match(call({ action: 'setPassword', newPassword: 'x1234567' }).error, /Sign in/);
  assert.match(call({ action: 'setPassword', newPassword: 'x1234567', token: tok, password: 'nope' }).error, /current password/);
});
t('wrong password, then right one', () => {
  assert.match(call({ action: 'login', password: 'nope' }).error, /Wrong password/);
  assert.ok(call({ action: 'login', password: 'bluebarn26' }).token);
  assert.strictEqual(call({ action: 'checkPassword', password: 'bluebarn26' }).good, true);
});
t('5 wrong tries lock it for 15 minutes', () => {
  for (let i = 0; i < 5; i++) call({ action: 'login', password: 'bad' + i });
  assert.match(call({ action: 'login', password: 'bluebarn26' }).error, /Too many/);
  be.ctx.PropertiesService.getScriptProperties().setProperty('PW_FAILS', '5|' + (Date.now() - 16 * 60000));
  assert.ok(call({ action: 'login', password: 'bluebarn26' }).token);
});
t('scale key: can check the password for Settings, cannot sign in to the office', () => {
  assert.strictEqual(be.call({ key: 'sk', action: 'checkPassword', password: 'bluebarn26' }).good, true);
  assert.match(be.call({ key: 'sk', action: 'login', password: 'bluebarn26' }).error, /scale key/);
  assert.match(be.call({ key: 'sk', action: 'officeData', token: tok }).error, /scale key/);
});
t('sign out ends the token; reset clears the password', () => {
  call({ action: 'logout', token: tok });
  assert.strictEqual(call({ action: 'officeData', token: tok }).signin, true);
  be.ctx.resetOfficePassword();
  assert.ok(call({ action: 'officeData' }).ok);
});
console.log(`\n${n} passed`);
