---
title: "Installing and Managing Node"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Installing and Managing Node

*16 min read · Updated 7 Oct 2026 · Topic 3 of 74 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0

---

## Say it in 30 seconds

A Node install is a directory that contains the `node` binary, plus an entry on `PATH` so the shell can find it. The shell walks `PATH` left to right and runs the first `node` it finds. A version manager keeps several of those directories and points `PATH` at the one a project asks for.

That exists so two projects can need two Node majors on one machine, and so `npm install -g` does not need root. The trade-off is that each managed version has its own global packages. Switch versions and a CLI you installed can disappear until you install it again.

`PATH` is the list of directories the shell searches for commands. The prefix is the directory npm uses for global packages.

## Why it matters

Before any server code runs, something has to put `node` on the machine and make the shell find it. That choice decides whether two projects can use two majors, whether a global install works without `sudo`, whether your laptop, CI, and production run the same version, and how painful the next upgrade is. Most "Node is broken" tickets on a new machine are this layer. `EACCES` on a global install, `node -v` still old after an upgrade, a CLI that vanished after a version switch, or CI green on 24 while a teammate on 22 gets `ReferenceError`. Each one is a directory you cannot write, an earlier `PATH` entry, a shell cache, or a per-version global folder.

## The concept, simply

The official Linux tarball for v24.21.0 contains, among the docs and headers, `bin/node` (one executable, about 120 MB), `bin/npm` and `bin/npx` (launchers for the bundled npm), `bin/corepack` (Node 24 still ships it; Node 25 and later do not), and `include/node/` (C headers for native addons).

Three families put that directory on the machine.

1. **Official installer or tarball.** One version, in a location the installer chooses, or wherever you unpack it.
2. **OS package** (`apt`, `dnf`, Homebrew, winget). One version, chosen by the distro, updated with the rest of the system.
3. **Version manager** (nvm, fnm, Volta, and others). Many versions side by side under your home directory. The manager changes `PATH`, or routes through a shim, so `node` means the version the project asks for.

On top of that is npm's prefix. `npm install -g` writes packages under `<prefix>/lib/node_modules` and links commands into `<prefix>/bin`. If you cannot write the prefix, you get `EACCES`.

## How it works

When you type `node app.js`:

1. The shell walks `$PATH` left to right and runs the first `node`. Bash remembers the result. Later lookups skip the walk until `hash -r`, or until `PATH` is reassigned.
2. A version manager may have rewritten `PATH`. `nvm use 22` prepends `~/.nvm/versions/node/v22.x.y/bin`. fnm prepends a per-shell symlink directory and repoints it. Volta puts `~/.volta/bin` first once, and `node` there is a shim that reads the nearest `package.json` on every call.
3. `process.execPath` is the absolute path of the binary that actually ran. When `node -v` surprises you, print this.
4. npm reads its prefix from `npm_config_*` variables, `~/.npmrc`, and the built-in default. The default is the directory the running Node was installed into. A system install is often root-owned, `/usr` or `/usr/local`. A version manager uses the version's own folder under your home.

| Method | Versions at once | Who updates it | Global installs need root? | Typical use |
| --- | --- | --- | --- | --- |
| nodejs.org installer or tarball | one | you | yes, for `/usr/local` | one machine, a quick start |
| OS package | one | the distro, on its schedule | yes, for `/usr` | servers managed with the OS |
| Version manager | many | you, per project | no, everything is under `$HOME` | a laptop with several projects |

Distro packages often trail upstream. On this machine, Ubuntu 26.04 LTS, the archive's Node 22 is older than the newest 22.x on nodejs.org, v22.23.3:

bash

```
$ apt-cache policy nodejs | head -3
nodejs:
  Installed: (none)
  Candidate: 22.22.1+dfsg+~cs22.19.15-1ubuntu1
```


| | nvm | fnm | Volta |
| --- | --- | --- | --- |
| Version tested | 0.40.8 | 1.39.0 | 2.0.2 |
| What it is | a shell script you `source`. `nvm` is a shell function | one Rust binary. `eval "$(fnm env)"` sets up the shell | Rust binaries plus a `volta-shim` |
| How `node` switches | rewrites `PATH` in this shell | repoints a per-shell symlink dir on `PATH` | `~/.volta/bin/node` is the shim, and it picks a version on each run |
| Reads | `.nvmrc` only | `.node-version`, then `.nvmrc`, then `engines.node` when neither file exists | the `"volta"` key in `package.json` |
| Auto-switch on `cd` | not by default | `fnm env --use-on-cd` | always, because the shim resolves per directory |
| Windows | no. nvm-windows is a separate project | yes, per its README | yes, per its README |
| Status | active, v0.40.8, Sep 2026 | active, v1.39.0, Mar 2026 | unmaintained. The README says so and points at `mise` |

> ⚠️ Unverified: the Windows rows for fnm and Volta come from their READMEs. No Windows machine was available to run them.

**Pin files.** `.nvmrc`, one line such as `22` or `v24.21.0`, is read by nvm and fnm. `.node-version` is the same shape, read by fnm, ignored by nvm. `"volta": { "node": "22.23.3" }` is written by `volta pin node@22`, which resolves `22` to an exact version. `"engines": { "node": ">=22" }` states compatibility. It does not select a version and it does not run at runtime. npm only warns unless `engine-strict=true`. Lesson 14.

**LTS and Current.** Every major starts as Current for about six months. Through Node 26, odd majors then reach end of life and even majors become Active LTS for about a year, then Maintenance, about 30 months in all. From Node 27, nodejs.org says one major per year, each with six months of Alpha and six of Current, and every major moves to LTS. Production should run Active or Maintenance LTS only. The line-by-line dates for 7 Oct 2026 are in Good to know. In three weeks from that reading, v24 drops to Maintenance and v26 becomes Active LTS. A floating alias such as nvm's `lts/*` or the Docker tag `node:lts-slim` moves on that day without a change on your side.

**Corepack** reads `"packageManager"` in `package.json`, for example `"pnpm@10.34.6"`, downloads that exact pnpm or Yarn, and runs it through shims. The Node 24 docs mark it experimental and say it will not be distributed starting with Node 25. The tarballs match: v24.21.0 contains `bin/corepack`. The v25.0.0 and v26.10.0 tarballs contain no file with "corepack" in the path. On 25 and later, install the `corepack` package from npm, or install pnpm or Yarn directly.

**Checksums.** Each release directory has `SHASUMS256.txt`, a detached `SHASUMS256.txt.sig`, and a clearsigned `SHASUMS256.txt.asc`. A checksum only proves the file matches the list. The signature, checked against the keys in `nodejs/release-keys`, proves a Node releaser produced the list. nvm printed `Checksums matched!` on every install in this lesson.

**`EACCES`.** `npm install -g` writes the prefix. If that directory is root-owned, `mkdir` fails with errno -13. `sudo npm` hides the error, runs install scripts as root, and leaves root-owned files in your cache. Point the prefix at a directory you own and add its `bin` to `PATH`, or use a version manager so the prefix is under `$HOME`.

**Upgrading.** A patch or minor inside one LTS line keeps the native-addon ABI. `process.versions.modules` stays `137` from 24.19.0 to 24.21.0. A major changes it, `127` on v22 and `137` on v24, so compiled addons need `npm rebuild`, and global CLIs must be installed again for the new version. Install the new version beside the old one, run the tests, update every pin together, then remove the old version.

**Docker.** The official `node` image pins a version by tag. `node:24-slim` follows the latest v24. `node:lts-slim` currently matches that digest and follows 26 after 2026-10-28. Pin a full version, or a digest, when the build must be repeatable.

## Code examples

**Example 1. Verify a download before you trust it.** The commands are the ones in the nodejs/node README, run in an empty directory with a throwaway `GNUPGHOME`.

bash

```
$ VERSION=v24.21.0
$ curl -fsSO "https://nodejs.org/dist/$VERSION/node-$VERSION-linux-x64.tar.xz"
$ curl -fsSO "https://nodejs.org/dist/$VERSION/SHASUMS256.txt.asc"
$ curl -fsSLo nodejs-keyring.kbx "https://github.com/nodejs/release-keys/raw/HEAD/gpg/pubring.kbx"

# 1. Check the signature and extract the signed checksum list
$ gpgv --keyring="$PWD/nodejs-keyring.kbx" --output SHASUMS256.txt < SHASUMS256.txt.asc
gpgv: Signature made Wed 09 Sep 2026 03:19:15 AM IST
gpgv:                using EDDSA key 5BE8A3F6C8A5C01D106C0AD820B1A390B168D356
gpgv: Good signature from "Antoine du Hamel <antoine.duhamel@platformatic.dev>"
gpgv:                 aka "Antoine du Hamel <duhamelantoine1995@gmail.com>"

# 2. Check the tarball against its line in that list
$ grep " node-$VERSION-linux-x64.tar.xz\$" SHASUMS256.txt | sha256sum -c -
node-v24.21.0-linux-x64.tar.xz: OK

# 3. A single extra byte is enough to fail
$ cp node-v24.21.0-linux-x64.tar.xz bad.tar.xz && printf 'x' >> bad.tar.xz
$ grep " node-$VERSION-linux-x64.tar.xz\$" SHASUMS256.txt | sed 's/node-v24.21.0-linux-x64.tar.xz/bad.tar.xz/' | sha256sum -c -
bad.tar.xz: FAILED
sha256sum: WARNING: 1 computed checksum did NOT match
$ echo $?
1
```

The `grep` keeps the one line you need. Without it, `sha256sum -c` complains about every other file unless you add `--ignore-missing`. On macOS the equivalent is `shasum -a 256 -c`.

> ⚠️ Unverified: `shasum -a 256 -c` on macOS was not run. No macOS machine was available.

**Example 2. nvm and `.nvmrc`.** nvm was installed with `HOME` set to a throwaway directory and `PROFILE=/dev/null`. The shell was started with `env -i` so the machine's own Node was not on `PATH`.

bash

```
$ . "$NVM_DIR/nvm.sh" && nvm --version
0.40.8
$ nvm ls-remote --lts | tail -3
       v24.19.0   (LTS: Krypton)
       v24.20.0   (LTS: Krypton)
       v24.21.0   (Latest LTS: Krypton)

# In a folder that has only .node-version:
$ cat .node-version
22
$ nvm use
No version provided and no .nvmrc file found
Please see `nvm --help` or https://github.com/nvm-sh/nvm#nvmrc for more information.

# In a folder with .nvmrc:
$ echo 22 > .nvmrc
$ nvm use
Found '…/p-nvm/.nvmrc' with version <22>
Now using node v22.23.3 (npm v10.9.9)
$ command -v node
…/nvmhome/.nvm/versions/node/v22.23.3/bin/node
$ nvm which 24
…/nvmhome/.nvm/versions/node/v24.21.0/bin/node
```

`nvm use` changes only the current shell. A new terminal gets the `default` alias, `nvm alias default 24`.

**Example 3. fnm reads `.node-version`, `.nvmrc`, and `engines`.**

bash

```
$ eval "$(fnm env --shell bash)"
$ cat .node-version
22
$ fnm install
Installing Node v22.23.3 (x64)

$ fnm use
Using Node v22.23.3

# a folder with only .nvmrc (containing 22)
$ fnm use
Using Node v22.23.3

# a folder with neither file, only engines
$ cat package.json
{ "name": "eng", "engines": { "node": "22" } }
$ fnm use
Using Node v22.23.3
$ fnm list
* v22.23.3
* v24.21.0 default
* system
```


**Example 4. Volta pins inside `package.json`.**

bash

```
$ volta --version
2.0.2
$ volta install node@24
$ node -v
v24.21.0

$ cd vproj && volta pin node@22
$ cat package.json
{
  "name": "vproj",
  "version": "1.0.0",
  "volta": {
    "node": "22.23.3"
  }
}
$ node -v
v22.23.3
$ ls -l $VOLTA_HOME/bin/node
lrwxrwxrwx … node -> …/volta/bin/volta-shim
$ cd .. && node -v
v24.21.0
```

The same `node` path gives a different version depending on the directory, because the shim chooses on each run, not the shell.

**Example 5. Corepack on Node 24, and its absence from 25 on.**

bash

```
$ node -v
v24.19.0
$ corepack --version
0.35.0

# Inside a throwaway nvm install of v24.21.0, a project with "packageManager": "pnpm@10.34.6"
$ corepack --version
0.36.0
$ corepack enable pnpm
$ ls -l $(dirname $(command -v node))/pnpm
lrwxrwxrwx … pnpm -> ../lib/node_modules/corepack/dist/pnpm.js
$ pnpm --version
10.34.6

# Count files named corepack in the official tarballs
$ curl -sSf https://nodejs.org/dist/v25.0.0/node-v25.0.0-linux-x64.tar.xz | tar -tJ | grep -c corepack
0
$ curl -sSf https://nodejs.org/dist/v26.10.0/node-v26.10.0-linux-x64.tar.xz | tar -tJ | grep -c corepack
0
```

`corepack enable` writes shims into the bin directory of the Node that runs it. That is why it was run only inside the throwaway install.

**Example 6. Reproduce `EACCES`, then fix the prefix.** The "system" prefix here is a throwaway directory with mode `555`. `HOME` is also a throwaway, so `npm config set` writes a throwaway `.npmrc`.

bash

```
$ mkdir ro-prefix && chmod 555 ro-prefix
$ npm_config_prefix=$PWD/ro-prefix npm install -g semver@7.7.2
npm error code EACCES
npm error syscall mkdir
npm error path …/npmdemo/ro-prefix/lib
npm error errno -13
npm error Error: EACCES: permission denied, mkdir '…/npmdemo/ro-prefix/lib'
…
$ echo $?
243

# Fix for one shell: a prefix you own, and its bin on PATH
$ export npm_config_prefix=$PWD/rw-prefix
$ npm prefix -g
…/npmdemo/rw-prefix
$ npm install -g semver@7.7.2

added 1 package in 592ms
$ command -v semver || echo "semver: not on PATH yet"
semver: not on PATH yet
$ export PATH="$npm_config_prefix/bin:$PATH"
$ semver 1.2.3 -i minor
1.3.0

# Permanent fix: store the prefix in ~/.npmrc (HOME was a throwaway here)
$ unset npm_config_prefix
$ npm config set prefix "$HOME/.npm-global"
$ cat $HOME/.npmrc
prefix=…/npmdemo/home/.npm-global
$ npm prefix -g
…/npmdemo/home/.npm-global
```

In real use, add `export PATH="$HOME/.npm-global/bin:$PATH"` to your shell startup file. Do not combine that prefix with nvm. A `prefix` in `~/.npmrc` stops global packages from following the active version, so nvm refuses to switch:

bash

```
$ echo "prefix=$HOME/g" > ~/.npmrc      # throwaway HOME
$ nvm use 22
Your user’s .npmrc file (${HOME}/.npmrc)
has a `globalconfig` and/or a `prefix` setting, which are incompatible with nvm.
Run `nvm use --delete-prefix v22.23.3` to unset it.
$ echo $?
11
```


**Example 7. You installed a newer Node and `node -v` is still old.** Bash caches where it found `node`. A new binary earlier on `PATH` does not reset that cache. Reassigning `PATH` does.

bash

```
$ type -a node
node is …/nvmhome/.nvm/versions/node/v22.23.3/bin/node
$ node -v
v22.23.3
$ ln -s …/v24.21.0/bin/node early-bin/node
$ node -v
v22.23.3
$ hash -t node
…/nvmhome/.nvm/versions/node/v22.23.3/bin/node
$ hash -r; node -v
v24.21.0
$ type -a node
node is …/pathdemo/early-bin/node
node is …/nvmhome/.nvm/versions/node/v22.23.3/bin/node
```

`type -a` lists every `node` on `PATH` in order. `hash -r` in bash, or `rehash` in zsh, clears the cache. So does a new terminal.

**PATH by operating system.** The Linux commands were run here. The others were not.

bash

```
# Linux (bash): which node runs, every node on PATH, and the PATH entries in order
$ command -v node
/home/anish.r/.nvm/versions/node/v24.19.0/bin/node
$ type -a node
node is /home/anish.r/.nvm/versions/node/v24.19.0/bin/node
$ node -p "process.execPath"
/home/anish.r/.nvm/versions/node/v24.19.0/bin/node
$ npm prefix -g
/home/anish.r/.nvm/versions/node/v24.19.0
$ echo "$PATH" | tr ':' '\n'
…
```


bash

```
# macOS (zsh): same idea; zsh uses `rehash` instead of `hash -r`
which -a node
echo $PATH | tr ':' '\n'
rehash
# PATH for login shells is assembled by /usr/libexec/path_helper from /etc/paths and /etc/paths.d/*
cat /etc/paths
```


> ⚠️ Unverified: the macOS commands were not run. No macOS machine was available.

text

```
# Windows (PowerShell)
Get-Command node -All          # every node.exe on PATH, in order
where.exe node                 # same, from cmd.exe or PowerShell
$env:Path -split ';'           # PATH entries in order
npm prefix -g                  # global packages live directly in this folder on Windows
```


> ⚠️ Unverified: the Windows commands were not run. No Windows machine was available. After you change PATH in System Settings, already-open terminals keep the old value. Open a new one.

**Example 8. A major upgrade: run the tests on the new version first.** A project pinned to 22 uses `URLPattern`, which is a global only since v24.0.0. `nvm exec` runs one command on another version without switching the shell.

bash

```
$ nvm exec 24 node --test --test-reporter=spec
Running node v24.21.0 (npm v11.19.0)
✔ matches /users/:id (0.763361ms)
ℹ pass 1
ℹ fail 0
$ nvm exec 22 node --test --test-reporter=spec
Running node v22.23.3 (npm v10.9.9)
✖ matches /users/:id (0.700426ms)
ℹ pass 0
ℹ fail 1
…
  ReferenceError: URLPattern is not defined

# The addon ABI number differs between majors, so native addons need `npm rebuild`
$ …/v22.23.3/bin/node -p "process.versions.modules"
127
$ …/v24.21.0/bin/node -p "process.versions.modules"
137

# Global CLIs belong to one version; copy them across explicitly
$ nvm use 22 && npm install -g semver@7.7.2

added 1 package in 535ms
$ nvm use 24
Now using node v24.21.0 (npm v11.19.0)
$ command -v semver || echo missing
missing
$ nvm reinstall-packages 22
…
$ npm ls -g --depth=0
…/nvmhome/.nvm/versions/node/v24.21.0/lib
+-- corepack@0.36.0
+-- npm@11.19.0
`-- semver@7.7.2
```

Once the project uses a v24-only global, `.nvmrc`, `engines`, the CI matrix, and the Docker `FROM` line all have to say 24 in the same commit.

**Example 9. Docker instead of a host install.** Docker was not installed here, so only the tag lookups were run.

bash

```
$ curl -s https://hub.docker.com/v2/repositories/library/node/tags/24-slim | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['name'],d['last_updated'])"
24-slim 2026-10-06T05:39:52.054532Z
$ for t in 24-slim lts-slim 26-slim; do curl -s https://hub.docker.com/v2/repositories/library/node/tags/$t | python3 -c "import json,sys;print('$t',json.load(sys.stdin)['digest'])"; done
24-slim sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
lts-slim sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
26-slim sha256:930557a230abacbc3f4fd9b8648abf8f4bee1e17cb72195dcdfb2f709bc85b33
```


bash

```
# Run one command on a pinned Node without installing it on the host
docker run --rm node:24.21.0-slim node -v

# Run the project's tests in the container, with the project mounted
docker run --rm -v "$PWD":/app -w /app node:24.21.0-slim npm test
```


> ⚠️ Unverified: the two `docker run` commands were not executed, so their output is not shown.

## Common mistakes & gotchas

- **`sudo npm install -g`.** It hides a root-owned prefix, runs package scripts as root, and leaves root-owned files in `~/.npm`. Move the prefix, or use a version manager.
- **Committing `.node-version` for a team on nvm.** nvm reads only `.nvmrc`. If the team mixes tools, commit both with the same content.
- **Thinking `engines` selects the version.** It does not. npm only warns unless `engine-strict=true`. fnm reads it only when no version file exists.
- **Expecting global CLIs to survive a version switch.** With nvm and fnm, each version has its own `lib/node_modules`. After `nvm use 24`, CLIs installed under 22 are gone until `nvm reinstall-packages 22`.
- **"`node -v` is old after I upgraded."** An earlier `PATH` entry, or the shell's command hash. Run `type -a node`, then `hash -r`.
- **Depending on bundled corepack.** It is gone from Node 25 on. `corepack enable` breaks when the runner moves to 26 unless corepack is installed from npm first.
- **Treating a checksum as proof of origin.** If someone can replace the tarball, they can replace `SHASUMS256.txt` too. Verify the signature, then the checksum.
- **Floating tags where you need the same bytes.** `lts/*`, `node:lts-slim`, and `node:24-slim` move. `lts-slim` becomes 26 on 2026-10-28.
- **Starting a new project on Volta.** It still runs. Its README says it is unmaintained and will not track new OS releases.

## Best practices

- Use a version manager on development machines. Everything stays under `$HOME`, several versions can coexist, and a pin file can switch them.
- Pin one committed file and make `engines`, CI, and the Docker `FROM` agree with it, changed in the same commit.
- Run production on Active or Maintenance LTS. On 7 Oct 2026 that is 24, or 22 until April 2027. Plan the move to 26 after it becomes LTS on 28 Oct 2026.
- For a manual download, run `gpgv` on `SHASUMS256.txt.asc` with the release-keys keyring, then `sha256sum -c` on that file's line.
- Never `sudo` npm. Fix the prefix, or let a version manager own it.
- Upgrade side by side. Install, test with `nvm exec`, `npm rebuild` native addons, reinstall globals, then move the pin and remove the old version.
- In containers, pin `node:24.21.0-slim` or a digest, not `node:latest`.

## ⭐ Interview lens

> **Q: “Why does `npm install -g` fail with EACCES, and what is the right fix?”**  
> npm writes global packages to `<prefix>/lib/node_modules` and links binaries into `<prefix>/bin`. With a system install that prefix is root-owned, `/usr` or `/usr/local`, so `mkdir` fails with errno -13. Point the prefix at a directory you own, `npm config set prefix ~/.npm-global`, and put its `bin` on `PATH`. Or use a version manager, whose prefix is the version folder under your home directory. The limit of "just use sudo" is that install scripts then run as root, and root-owned files in the npm cache break later installs that are not root.

> **Q: “How do nvm, fnm and Volta switch Node versions, mechanically?”**  
> nvm is a shell function you source. `nvm use` rewrites `PATH` in the current shell so it points at `~/.nvm/versions/node/vX/bin`. fnm puts a per-shell symlink directory on `PATH` and repoints that directory. Volta puts one shim named `node` on `PATH`, and on every run the shim reads the nearest `package.json` `"volta"` key and executes that version. nvm reads `.nvmrc` only. fnm reads `.node-version`, then `.nvmrc`, then `engines.node`. Volta reads only its own key. The limit is Volta for a new project. Its README says it is unmaintained.

> **Q: “What is the difference between LTS and Current, and what would you run in production today?”**  
> A new major is Current for about six months. Through Node 26, even majors then become Active LTS and later Maintenance, about 30 months in all, and odd majors reach end of life. From Node 27, every annual major is planned to become LTS. Production should run Active or Maintenance only. On 7 Oct 2026 that is v24, Active until 20 Oct, then Maintenance until 2028-04-30. v26 becomes Active LTS on 28 Oct. The limit of a floating `lts` tag is that it moves on that day by itself. Pin the full version when the build must stay put.

> **Q: “A colleague says they upgraded Node but `node -v` still shows the old version. How do you debug it?”**  
> Run `type -a node`, or `which -a`, or `Get-Command node -All` on Windows, and read every `node` on `PATH` in order. Compare that with `node -p process.execPath`, the binary that actually started. The usual causes are an older system install earlier on `PATH`, a version manager's default alias, and the shell's command hash. `hash -r` or `rehash` clears the hash. A new terminal does too. The limit is fixing it once in one shell. Bash will cache the old path again until `PATH` is reassigned or the hash is cleared.

## Cheat-card

- An install is a directory (`bin/node`, `bin/npm`, `bin/npx`, `lib/node_modules/npm`) plus a `PATH` entry.
- Three sources: nodejs.org, the OS package, or a version manager under `$HOME`.
- Pin files: `.nvmrc` for nvm and fnm, `.node-version` for fnm (nvm ignores it), `"volta"` in `package.json`. `engines` does not pick a version.
- Volta's README says it is unmaintained and points at `mise`.
- Corepack is bundled through Node 24 and is not shipped from v25. Install it from npm if you still need it.
- Verify with `gpgv` on `SHASUMS256.txt.asc`, then `sha256sum -c` on that file's line.
- `EACCES` means the prefix is not writable. Change the prefix or use a version manager. Do not use `sudo`.
- Wrong version: `type -a node`, `process.execPath`, `hash -r`.
- A major upgrade changes the ABI, 127 to 137. `npm rebuild`, reinstall globals, and move every pin together.
- In Docker, pin `node:24.21.0-slim` or a digest.

## Good to know

- Q: How do you verify a Node binary you downloaded? Download `SHASUMS256.txt.asc`, verify it with `gpgv` against the nodejs/release-keys keyring, then check the tarball with `sha256sum -c` against its line in that list. The checksum alone only proves the file matches a list that might itself have been replaced.
- Release lines read on 2026-10-07: v20 Iron, released 2023-04-18, Active LTS 2023-10-24, Maintenance 2024-10-22, end of life 2026-04-30. v22 Jod, released 2024-04-24, LTS 2024-10-29, Maintenance 2025-10-21, end 2027-04-30. v24 Krypton, released 2025-05-06, LTS 2025-10-28, Maintenance 2026-10-20, end 2028-04-30, latest in the lesson v24.21.0, Active on that date. v25 released 2025-10-15, never LTS, Maintenance 2026-04-01, end 2026-06-01. v26 released 2026-05-05, LTS 2026-10-28, Maintenance 2027-10-20, end 2029-04-30, Current on that date, latest v26.10.0. v27 alpha 2026-10-28, release 2027-04-22, Maintenance listed 2027-10-20, end 2030-04-30, LTS date not listed.
- Corepack on the v24.19.0 in this kit reports 0.35.0. The userland package mentioned for Node 25 and later was corepack 0.36.0 at the time of writing.
- nvm tested 0.40.8 (Sep 2026), fnm 1.39.0 (Mar 2026), Volta 2.0.2. A lone `.node-version` made nvm say no version was provided and no `.nvmrc` was found.

---

## Learn More

- [Node.js Releases nodejs.org](https://nodejs.org/en/about/previous-releases)
- [Download Node.js nodejs.org](https://nodejs.org/en/download)
- [Verifying binaries github.com/nodejs/node](https://github.com/nodejs/node#verifying-binaries)
- [nodejs/release-keys github.com](https://github.com/nodejs/release-keys)
- [nvm github.com](https://github.com/nvm-sh/nvm)
- [fnm github.com](https://github.com/Schniz/fnm)
- [Understanding Volta docs.volta.sh](https://docs.volta.sh/guide/understanding)
- [Corepack (v24 docs) nodejs.org](https://nodejs.org/docs/latest-v24.x/api/corepack.html)
- [Resolving EACCES permissions errors when installing packages globally docs.npmjs.com](https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally)
- [node official image hub.docker.com](https://hub.docker.com/_/node)

