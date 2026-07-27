#!/usr/bin/env python3
"""Resolve the D1 databases once, then migrate or serve against exactly what was resolved.

Why this exists (#5, R4). `wrangler pages dev --d1 BINDING=VALUE` keys its local SQLite file
by VALUE. `wrangler d1 migrations apply --local` keys its file by the database_id it resolved
from config. Hand those two a different string and they quietly open different local databases:
the migration reports six commands executed, the API sees no tables, and nothing in either
output says why. So this script resolves the uuid once and hands the same uuid to both,
printing it on every path so a mismatch is visible rather than mysterious.

Why the remote migrations run through here too. Most of `wrangler d1` resolves a database by
name against the account API — `d1 list`, `d1 info` and `d1 execute --remote` all do, verified
27 Jul 2026. `d1 migrations apply` does not, on either `--local` or `--remote`: it fails with
"Couldn't find a D1 DB with the name or binding … in your wrangler.toml file". And
`wrangler.toml` deliberately carries no binding (Decision 3: a database_id is per-agency config
and that file is engine, shared by every agency). So this generates a throwaway config under
`.wrangler/`, which is gitignored, and points `-c` at it. One generator, one resolution path,
four npm scripts — rather than the same trick reimplemented per script and drifting.

`migrations_dir` in the generated config is absolute, because a relative one resolves against
the config file's own directory and would send wrangler looking for `.wrangler/migrations`.
`--persist-to` is passed explicitly for the same reason the uuid is: two commands agreeing by
accident is not the same as two commands agreeing.

Usage:
    ./scripts/dev.py                            # migrate locally, then serve on :8788
    ./scripts/dev.py --migrate-only             # migrate locally and stop   (npm run db:local)
    ./scripts/dev.py --migrate-remote preview   # migrate the preview D1     (npm run db:preview)
    ./scripts/dev.py --migrate-remote production # migrate production's D1   (npm run db:remote)
"""

import json
import os
import subprocess
import sys

WRANGLER = "wrangler@4.114.0"
NVM_ROOT = os.path.expanduser("~/.nvm/versions/node")

# environment -> (D1 database name, binding used in the generated config).
# Per-agency values, read from the environment: this file is engine, shared by every agency,
# and editing it to onboard a second one is the per-agency fork Decision 3 forbids. Same two
# variables as scripts/setup-d1.py, deliberately.
D1_NAME = os.environ.get("DOSSIER_D1_NAME", "dossier-engine")
DATABASES = {
    "preview": (os.environ.get("DOSSIER_D1_NAME_PREVIEW", f"{D1_NAME}-preview"), "DB"),
    "production": (D1_NAME, "DB_PRODUCTION"),
}
# `pages dev` serves the preview database. Production is only ever migrated, never served here.
LOCAL_ENV = "preview"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE = os.path.join(ROOT, ".wrangler", "state")
CONFIG = os.path.join(ROOT, ".wrangler", "d1-local.toml")


def node22_path():
    """A PATH whose `node` is >= 22. Wrangler needs it; this machine's default is v20."""
    def major(binary):
        try:
            out = subprocess.run([binary, "-v"], capture_output=True, text=True).stdout
            return int(out.strip().lstrip("v").split(".")[0])
        except (OSError, ValueError):
            return 0

    if major("node") >= 22:
        return os.environ["PATH"]

    for name in sorted(os.listdir(NVM_ROOT) if os.path.isdir(NVM_ROOT) else [], reverse=True):
        candidate = os.path.join(NVM_ROOT, name, "bin")
        if major(os.path.join(candidate, "node")) >= 22:
            return candidate + os.pathsep + os.environ["PATH"]

    sys.exit(
        "no Node >= 22 found, and wrangler needs one. Install one, or put an existing one "
        'on PATH:\n\n    export PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH"\n'
    )


def run(args, env, **kwargs):
    return subprocess.run(["npx", WRANGLER, *args], env=env, **kwargs)


def resolve(env):
    """Every database this repo uses, by name -> uuid, from the account API."""
    listed = run(["d1", "list", "--json"], env, capture_output=True, text=True)
    if listed.returncode != 0:
        sys.exit(f"could not list D1 databases — run `npx {WRANGLER} login`?\n{listed.stderr}")
    try:
        by_name = {d["name"]: d["uuid"] for d in json.loads(listed.stdout)}
    except json.JSONDecodeError:
        sys.exit(f"unreadable `d1 list --json` output:\n{listed.stdout}")

    uuids = {}
    for environment, (name, _) in DATABASES.items():
        if name not in by_name:
            sys.exit(f"no D1 database named {name} — run: npx {WRANGLER} d1 create {name}")
        uuids[environment] = by_name[name]
        # flush=True throughout: this script can end in an execvpe, which discards buffered
        # stdout. A uuid nobody sees does not close R4.
        print(f"{environment:<10} {name} → {by_name[name]}", flush=True)
    return uuids


def write_config(uuids):
    """The throwaway config `d1 migrations apply` insists on. Gitignored, never deployed."""
    blocks = "".join(
        "\n[[d1_databases]]\n"
        f'binding = "{binding}"\n'
        f'database_name = "{name}"\n'
        f'database_id = "{uuids[environment]}"\n'
        # json.dumps, not an f-string: a checkout path containing a quote or a backslash
        # produces a wrangler parse error that names the generated file rather than the cause.
        # TOML basic strings and JSON strings escape the same way.
        f"migrations_dir = {json.dumps(os.path.join(ROOT, 'migrations'))}\n"
        for environment, (name, binding) in DATABASES.items()
    )
    os.makedirs(os.path.dirname(CONFIG), exist_ok=True)
    with open(CONFIG, "w") as f:
        f.write(
            "# Generated by scripts/dev.py. Throwaway, gitignored, never deployed: it exists\n"
            "# only because `d1 migrations apply` insists on a config entry, while the tracked\n"
            "# wrangler.toml deliberately carries no binding (#5, Decision 3).\n"
            'name = "saulera-dossier-engine-d1-local"\n'
            'compatibility_date = "2026-07-27"\n' + blocks
        )


def migrate(env, environment, uuids, local):
    _, binding = DATABASES[environment]
    where = ["--local", "--persist-to", STATE] if local else ["--remote"]
    applied = run(["d1", "migrations", "apply", binding, "-c", CONFIG, *where], env)
    if applied.returncode != 0:
        sys.exit(f"✗ migration failed against {environment} — see the wrangler output above")
    scope = "local" if local else "remote"
    print(f"✓ migrated the {scope} database for {uuids[environment]}", flush=True)


def main():
    args = sys.argv[1:]
    env = {**os.environ, "PATH": node22_path()}

    remote_env = None
    if "--migrate-remote" in args:
        try:
            remote_env = args[args.index("--migrate-remote") + 1]
        except IndexError:
            remote_env = None
        if remote_env not in DATABASES:
            sys.exit(f"--migrate-remote takes one of: {', '.join(DATABASES)}")

    uuids = resolve(env)
    write_config(uuids)

    if remote_env:
        migrate(env, remote_env, uuids, local=False)
        return

    print(f"local state → {STATE}", flush=True)
    migrate(env, LOCAL_ENV, uuids, local=True)

    if "--migrate-only" in args:
        return

    binding, uuid = DATABASES[LOCAL_ENV][1], uuids[LOCAL_ENV]
    print(f"serving public/ with {binding}={uuid} on http://localhost:8788", flush=True)
    os.execvpe(
        "npx",
        ["npx", WRANGLER, "pages", "dev", "public",
         "--d1", f"{binding}={uuid}", "--persist-to", STATE],
        env,
    )


if __name__ == "__main__":
    main()
