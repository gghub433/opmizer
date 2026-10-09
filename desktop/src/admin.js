'use strict';
/**
 * Elevation helpers.
 *   isAdmin()            -> Promise<bool> (cached; always false off Windows)
 *   isOtherUser()        -> Promise<bool> (cached) elevated as a different account than the signed-in user
 *   relaunchAsAdmin(app) -> starts an elevated copy through UAC and quits this one
 */
const { run, ps, psQuote } = require('./run');
const { HostError, unsupported } = require('./errors');

let cached = null;

async function detect(platform) {
  if (platform !== 'win32') return false;
  // `net session` succeeds only in an elevated token…
  const r = await run('net.exe', ['session'], { timeout: 8000 });
  if (r.code === 0) return true;
  // …but also fails for admins when the Server service is stopped, so double-check with the token itself.
  const p = await ps('([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent())' +
    '.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)', { timeout: 10000 });
  return p.code === 0 && /true/i.test(p.stdout);
}

function isAdmin(platform) {
  const plat = platform || process.platform;
  if (!cached) cached = detect(plat).catch(() => false);
  return cached;
}

/**
 * A standard user who elevates types an administrator's password into UAC: the elevated GinN then runs as
 * that administrator, so HKCU (and %APPDATA%) belong to them, not to the person at the keyboard.
 * The person signed in to this Windows session is the owner of the session's shell (explorer.exe).
 */
const OTHER_USER_SCRIPT = "Write-Output ('GINN_ME ' + [Security.Principal.WindowsIdentity]::GetCurrent().User.Value); " +
  '$s=(Get-Process -Id $PID).SessionId; ' +
  "$e=Get-CimInstance Win32_Process -Filter \"Name='explorer.exe' AND SessionId=$s\" -ErrorAction SilentlyContinue | " +
  'Sort-Object CreationDate | Select-Object -First 1; ' +
  'if ($e) { $o=Invoke-CimMethod -InputObject $e -MethodName GetOwnerSid -ErrorAction SilentlyContinue; ' +
  "if ($o -and $o.Sid) { Write-Output ('GINN_SHELL ' + $o.Sid) } }";

/** Script output -> true only when both SIDs are known and differ (no shell found = assume the same user). */
function parseOtherUser(out) {
  const me = /GINN_ME (S-[\d-]+)/i.exec(out || '');
  const shell = /GINN_SHELL (S-[\d-]+)/i.exec(out || '');
  return !!(me && shell && me[1].toUpperCase() !== shell[1].toUpperCase());
}

let otherCached = null;

function isOtherUser(platform) {
  const plat = platform || process.platform;
  if (!otherCached) {
    otherCached = (async () => {
      if (plat !== 'win32' || !(await isAdmin(plat))) return false; // without elevation it is the user's own token
      const r = await ps(OTHER_USER_SCRIPT, { timeout: 20000 });
      return r.code === 0 && parseOtherUser(r.stdout);
    })().catch(() => false);
  }
  return otherCached;
}

function resetCache() { cached = null; otherCached = null; }

/** Build the PowerShell that starts `exe args` elevated and prints GINN_OK / GINN_CANCELLED / GINN_ERR:… */
function relaunchScript(exe, args) {
  const list = (args || []).map((a) => psQuote('"' + String(a).replace(/"/g, '') + '"'));
  return 'try {' +
    ' Start-Process -FilePath ' + psQuote(exe) +
    (list.length ? ' -ArgumentList @(' + list.join(',') + ')' : '') +
    ' -Verb RunAs -ErrorAction Stop | Out-Null; Write-Output "GINN_OK"' +
    ' } catch {' +
    ' $c = 0; $e = $_.Exception;' +
    ' while ($e) { if ($e.NativeErrorCode) { $c = $e.NativeErrorCode }; $e = $e.InnerException };' +
    ' if ($c -eq 1223 -or $_.Exception.Message -match "cancel|отмен") { Write-Output "GINN_CANCELLED" }' +
    ' else { Write-Output ("GINN_ERR:" + $_.Exception.Message) } }';
}

/**
 * @param {object} o  {app, platform, env, execPath}
 */
async function relaunchAsAdmin(o) {
  const platform = o.platform || process.platform;
  if (platform !== 'win32') throw unsupported('Права администратора бывают только в Windows');
  if (await isAdmin(platform)) return {};
  const app = o.app;
  const env = o.env || process.env;
  const exe = env.PORTABLE_EXECUTABLE_FILE || o.execPath || process.execPath;
  const args = app.isPackaged ? [] : [app.getAppPath()];
  // The elevated copy must be able to take the single-instance lock, so let go of it first.
  if (app.releaseSingleInstanceLock) app.releaseSingleInstanceLock();
  const r = await ps(relaunchScript(exe, args), { timeout: 120000 });
  const out = r.stdout || '';
  if (/GINN_OK/.test(out)) {
    setTimeout(() => app.quit(), 150);
    return {};
  }
  if (app.requestSingleInstanceLock) app.requestSingleInstanceLock();
  if (/GINN_CANCELLED/.test(out)) throw new HostError('CANCELLED', 'Запрос прав отменён');
  throw new HostError('FAILED', 'Не удалось перезапустить GinN от имени администратора', out + r.stderr);
}

module.exports = { isAdmin, isOtherUser, parseOtherUser, resetCache, relaunchAsAdmin, relaunchScript, OTHER_USER_SCRIPT };
