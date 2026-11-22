// pnpm dev on a Mac (scripts/dev-identity.mjs): starts Electron answering for its own permissions.
// A program started from a terminal (or any app) is, for the Mac's permissions, that app's: the microphone, call
// audio, calendar and Accessibility would be asked for, and remembered, in the terminal's name. Started through this,
// Electron (Faisselle Dev) is the one asked, as the installed app is. The way Chromium starts its own processes.
//   FAISSELLE_DEV_ELECTRON=ELECTRON dev-launcher ARGS...   runs ELECTRON with ARGS, passes signals on, exits as it exits
// (electron-vite starts ELECTRON_EXEC_PATH, set to this, with the app's entry as its first argument)
#include <errno.h>
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

extern char **environ;
// libSystem, since macOS 10.14 (not in the SDK's headers)
extern int responsibility_spawnattrs_setdisclaim(posix_spawnattr_t *attrs, int disclaim);

static pid_t child = 0;
static void pass_on(int sig) { if (child > 0) kill(child, sig); }

int main(int argc, char **argv) {
  const char *electron = getenv("FAISSELLE_DEV_ELECTRON");
  if (!electron || !*electron) { fprintf(stderr, "dev-launcher: FAISSELLE_DEV_ELECTRON is not set\n"); return 64; }
  argv[0] = (char *)electron; // Electron's own argv: its path, then what electron-vite passed
  posix_spawnattr_t attr;
  posix_spawnattr_init(&attr);
  if (responsibility_spawnattrs_setdisclaim(&attr, 1) != 0) fprintf(stderr, "dev-launcher: could not make Electron answer for its own permissions\n");
  int e = posix_spawn(&child, electron, NULL, &attr, argv, environ);
  posix_spawnattr_destroy(&attr);
  if (e != 0) { fprintf(stderr, "dev-launcher: %s: %s\n", electron, strerror(e)); return 127; }
  int sigs[] = { SIGINT, SIGTERM, SIGHUP, SIGQUIT };
  for (unsigned i = 0; i < sizeof sigs / sizeof *sigs; i++) signal(sigs[i], pass_on);
  int status;
  while (waitpid(child, &status, 0) < 0) if (errno != EINTR) return 1;
  return WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
}
