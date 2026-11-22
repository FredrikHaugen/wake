# Homebrew Tap Implementation Plan

> **Superseded in places (2026-11-22):** Homebrew 7 refuses short-name installs from untrusted taps, so the install command is now `brew install fredrikhaugen/tap/wake` (see README.md). `brew style --fix` also reordered the formula's dependencies and replaced `Formula["node"].opt_bin` with `formula_opt_bin("node")`; the tap's Formula/wake.rb is the current version.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anyone on a Mac can install wake with `brew tap fredrikhaugen/tap` and then `brew install wake`.

**Architecture:** Release wake 1.0.0 from the now-public `FredrikHaugen/wake` repo, and point a formula in a new public tap repo, `FredrikHaugen/homebrew-tap`, at that tag's source archive. The formula copies `bin/`, `src/` and `package.json` into `libexec` and runs them with Homebrew's own Node. There is no `npm install`, because Node refuses to strip TypeScript under `node_modules`.

**Tech Stack:** Homebrew 7 (formula Ruby DSL, `brew tap-new`, `brew audit`, `brew style`, `brew test`), GitHub (`gh` CLI), Node from the Homebrew `node` formula (26.x).

**Spec:** No separate spec. The request is the user's message of 2026-11-22: make wake installable through a custom tap. It follows the user's outlined steps: tag a release, write a formula, test with `brew install --build-from-source` and `brew audit --strict`, and host the tap as a public `homebrew-<tapname>` repo with the formula in `Formula/`. The user also answered these questions on 2026-11-22:
- **Repo visibility:** make the wake repo public as-is, full history included.
- **Tap name:** `homebrew-tap`.
- **License:** MIT.

**Checked on this Mac on 2026-11-22:**
- **Homebrew and Node:** Homebrew 7.0.15. The `node` formula is 26.13.1.
- **Node under `node_modules`:** importing a `.ts` file from under `node_modules` fails with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. That rules out `brew create --node`'s `npm install *std_npm_args` template, which installs into `libexec/lib/node_modules`.
- **Existing `wake` command:** `/opt/homebrew/bin/wake` is currently the `npm link` symlink (`../lib/node_modules/wake/bin/wake.js`). Brew can't link over it.
- **Name availability:** `FredrikHaugen/homebrew-tap` doesn't exist yet.
- **Commit author:** every commit in the wake repo is authored as `fredrikhaugen <fredrik@haugendesign.net>`.
- **Brew tooling:** `brew tap-new` supports `--branch`; `Pathname#write_env_script` exists.

## Global Constraints

- Version `1.0.0` in `package.json`, git tag `v1.0.0`, GitHub release titled `wake 1.0.0`.
- License: MIT, with the line `Copyright (c) 2026 Fredrik Haugen`. `package.json` gets `"license": "MIT"`; the formula gets `license "MIT"`.
- Source archive URL: `https://github.com/FredrikHaugen/wake/archive/refs/tags/v1.0.0.tar.gz`. Homepage: `https://github.com/FredrikHaugen/wake`.
- The tap repo is `FredrikHaugen/homebrew-tap` (public, branch `main`), with the formula at `Formula/wake.rb`. Users type `brew tap fredrikhaugen/tap` and `brew install wake`.
- The formula never runs npm. It installs `bin`, `src` and `package.json` into `libexec` and runs `libexec/bin/wake.js` with `Formula["node"].opt_bin` first on PATH.
- The formula declares `depends_on :macos`: wake is macOS-only today.
- No bottles and no GitHub Actions in the tap. Installing is a file copy, so a source install is instant.
- Outward-facing actions this plan is approved for, and no others: make `FredrikHaugen/wake` public, push wake's `main`, create the `v1.0.0` tag and release, create the public `FredrikHaugen/homebrew-tap` repo, and push it. No pull request to homebrew-core.
- Remove the `npm link`ed wake (`npm unlink -g wake`) before the first `brew install`.
- Tap commit messages follow Homebrew's convention, e.g. `wake 1.0.0 (new formula)`. Wake repo commits use Conventional Commits. All commits end with the `Co-Authored-By` trailer the session supplies.

## Review Focus

1. **An old `npm link`ed `wake` is still in `/opt/homebrew/bin`.** Brew must end up owning the command, not leave the old symlink in place. → Task 3 checks where `/opt/homebrew/bin/wake` points; Task 1's README tells from-source users to unlink first.
2. **A formula that installs under `node_modules`.** wake would crash on its first import. → Task 3's `brew test` runs `wake --help` and `wake 3x`, which load the TypeScript sources.
3. **Another `node` earlier on PATH** (nvm, Volta, an old system Node). wake must still run on Homebrew's Node. → Task 3 runs wake with a fake failing `node` first on PATH.
4. **Archive drift**: the tag moves, the checksum changes, or `bin/wake.js` loses its executable bit. Install would fail or the command wouldn't run. → Task 2 checks the anonymous download, the SHA-256 and the file modes; Task 4's fresh install re-downloads and verifies the checksum.
5. **The real user flow** (a clone of the tap from GitHub, not the local copy used while building). → Task 4 untaps, taps from GitHub, installs, and runs wake.

---

### Task 1: Prepare wake for its first release

**Files:**
- Create: `LICENSE`
- Modify: `package.json` (`version`, add `license`), `README.md` (Install, Uninstall, new License section)

**Interfaces:**
- Produces: `main` on `origin` containing version `1.0.0`, `LICENSE` and the README install instructions, ready for Task 2 to tag.

- [ ] **Step 1: Write `LICENSE`**: the standard MIT License text (https://opensource.org/license/mit) with the line `Copyright (c) 2026 Fredrik Haugen`.

- [ ] **Step 2: Update `package.json`**: set `"version": "1.0.0"` and add `"license": "MIT"` after `"description"`. Change nothing else.

- [ ] **Step 3: Update `README.md`**
  - Replace the Install section with: a code block containing `brew tap fredrikhaugen/tap` and `brew install wake`, then the line "Needs macOS. Homebrew installs Node for you."
  - Below that, add a "From source" paragraph: `npm install`, then `npm link`, which needs Node 24 or newer. Add the sentence "If you installed from source before and now switch to Homebrew, run `npm unlink -g wake` first, or Homebrew can't link the command."
  - Replace the Uninstall block with `brew uninstall wake`, then the from-source line `npm unlink -g wake`.
  - Append the section `## License` containing: "MIT. See [LICENSE](LICENSE)."
  - Leave Usage and How it works untouched.

- [ ] **Step 4: Check nothing broke**

Run: `npm test && npm run check`
Expected: 60 tests pass, `tsc` exits 0. Then `node -e "import('./src/args.ts').then(m => console.log(require('fs').readFileSync('README.md','utf8').includes(m.HELP)))"` prints `true`: the README still holds the help text verbatim.

- [ ] **Step 5: Commit and push**

```bash
git add LICENSE package.json README.md docs/superpowers/plans/2026-11-22-homebrew-tap.md
git commit -m "chore: release 1.0.0 under the MIT license"
git push origin main
```

Expected: `git status -sb` shows `## main...origin/main` with nothing ahead.

---

### Task 2: Make wake public and release v1.0.0

**Files:** none (GitHub state only)

**Interfaces:**
- Consumes: `main` from Task 1.
- Produces: the public archive at the Global Constraints URL and its SHA-256 (64 hex characters). Write the SHA-256 in the report as `SHA256=<hex>`; Task 3 puts it in the formula.

- [ ] **Step 1: Make the repo public**

Run: `gh repo edit FredrikHaugen/wake --visibility public --accept-visibility-change-consequences`, then `gh repo view FredrikHaugen/wake --json visibility --jq .visibility`
Expected: `PUBLIC`

- [ ] **Step 2: Create the tag and release**

Run: `gh release create v1.0.0 --repo FredrikHaugen/wake --target main --title "wake 1.0.0" --notes "First release. Install with: brew tap fredrikhaugen/tap && brew install wake"`, then `git fetch --tags origin`
Expected: the release URL is printed, and `git rev-parse v1.0.0^{commit}` equals `git rev-parse origin/main`.

- [ ] **Step 3: Check the archive is downloadable anonymously and complete**

Download it with no credentials, using `curl -fsSL` (not `gh`, so no token is used), into a new empty temporary directory: `curl -fsSL https://github.com/FredrikHaugen/wake/archive/refs/tags/v1.0.0.tar.gz -o "$DIR/wake-1.0.0.tar.gz"`. Then run `shasum -a 256` on it and `tar -tzvf` it.
Expected:
- curl exits 0.
- The listing includes `wake-1.0.0/bin/wake.js` with mode `-rwxr-xr-x`, plus `wake-1.0.0/src/run.ts`, `wake-1.0.0/package.json` and `wake-1.0.0/LICENSE`.
- Record `SHA256=<hex>`.

- [ ] **Step 4: Check the checksum is stable**

Download the archive a second time into the same directory under another name and compare the SHA-256.
Expected: identical. If not, stop and report: the formula can't pin an unstable archive.

---

### Task 3: Tap and formula, tested locally

**Files** (in the tap repo at `$(brew --repository)/Library/Taps/fredrikhaugen/homebrew-tap`):
- Create: `Formula/wake.rb`, `README.md`
- Delete: `.github/` (generated by `brew tap-new`)

**Interfaces:**
- Consumes: `SHA256` from Task 2.
- Produces: a committed local tap `fredrikhaugen/tap` whose `wake` formula passes `brew test`, `brew audit --strict --online` and `brew style`, ready for Task 4 to publish.

- [ ] **Step 1: Scaffold the tap**

Run: `brew tap-new --branch=main FredrikHaugen/tap`, then `git -C "$(brew --repository)/Library/Taps/fredrikhaugen/homebrew-tap" rm -r -q .github`
Expected: the tap directory exists as a git repo on `main`, and it has no `.github/` left.

- [ ] **Step 2: Write `Formula/wake.rb`** exactly like this, putting Task 2's hex in place of `SHA256`:

```ruby
class Wake < Formula
  desc "Keep your Mac awake with a countdown that fills the terminal"
  homepage "https://github.com/FredrikHaugen/wake"
  url "https://github.com/FredrikHaugen/wake/archive/refs/tags/v1.0.0.tar.gz"
  sha256 "SHA256"
  license "MIT"

  depends_on "node"
  depends_on :macos

  def install
    libexec.install "bin", "src", "package.json"
    (bin/"wake").write_env_script libexec/"bin/wake.js", PATH: "#{Formula["node"].opt_bin}:$PATH"
  end

  test do
    assert_match "Usage: wake [duration]", shell_output("#{bin}/wake --help")
    assert_match "is not a duration", shell_output("#{bin}/wake 3x 2>&1", 2)
  end
end
```

The test block deliberately does not start caffeinate: `brew test` runs in a sandbox.

- [ ] **Step 3: Replace the generated `README.md`** with: the title `# fredrikhaugen/tap`, the line "Homebrew formulae by Fredrik Haugen.", a code block with `brew tap fredrikhaugen/tap` and `brew install wake`, and a list with one entry: `wake`, "keep your Mac awake with a countdown that fills the terminal", linked to https://github.com/FredrikHaugen/wake.

- [ ] **Step 4: Remove the `npm link`ed command**

Run: `npm unlink -g wake`, then `ls /opt/homebrew/bin/wake`
Expected: "No such file or directory".

- [ ] **Step 5: Install from the local tap**

Run: `brew install --build-from-source fredrikhaugen/tap/wake`, then `readlink /opt/homebrew/bin/wake`
Expected: the install succeeds with no "Could not symlink" warning, and readlink prints `../Cellar/wake/1.0.0/bin/wake`.

- [ ] **Step 6: Run Homebrew's checks**

Run: `brew test fredrikhaugen/tap/wake`, `brew audit --strict --online fredrikhaugen/tap/wake` and `brew style fredrikhaugen/tap`
Expected: `brew test` passes, and audit and style report no problems.
- If `brew style` reports a component-order offense, apply `brew style --fix fredrikhaugen/tap` and re-run all three.
- Any other finding: fix the formula as the message says, without changing the Global Constraints values, and record what you changed.

- [ ] **Step 7: Check that another `node` on PATH can't break it**

In a new empty temporary directory, create an executable `node` that runs `echo fake-node; exit 1`. Then run `env PATH="$FAKE_DIR:/usr/bin:/bin" /opt/homebrew/bin/wake --help`.
Expected: the usage text, not `fake-node`.

- [ ] **Step 8: Check it really keeps the Mac awake**

Start `/opt/homebrew/bin/wake 3s </dev/null >"$OUT" &` and note its pid. After 1.5 s, run `pmset -g assertions` and check that a `PreventUserIdleDisplaySleep` line is followed by a line ending in `on behalf of Process ID <pid>`. Then wait for the pid to exit.
Expected: the assertion is present, the exit status is 0, and the last line of `$OUT` is `wake: done after 3s. Your Mac can sleep again.`

- [ ] **Step 9: Commit in the tap repo**

```bash
cd "$(brew --repository)/Library/Taps/fredrikhaugen/homebrew-tap"
git add Formula/wake.rb README.md
git commit -m "wake 1.0.0 (new formula)"
```

Expected: `git status --short` is empty.

---

### Task 4: Publish the tap and install it the way a user would

**Files:** none (GitHub state and the local Homebrew install)

**Interfaces:**
- Consumes: the committed local tap from Task 3.
- Produces: the public `FredrikHaugen/homebrew-tap`, and `wake` on this Mac installed from it.

- [ ] **Step 1: Create and push the public tap repo**

Run: `gh repo create FredrikHaugen/homebrew-tap --public --description "Homebrew formulae by Fredrik Haugen" --source "$(brew --repository)/Library/Taps/fredrikhaugen/homebrew-tap" --remote origin --push`
Expected: the repo URL is printed, and `git -C <tap dir> status -sb` shows `## main...origin/main` with nothing ahead.

- [ ] **Step 2: Drop the local tap**

`brew untap` deletes the local directory, so do this only after Step 1 shows nothing unpushed.
Run: `brew uninstall wake && brew untap fredrikhaugen/tap`
Expected: both succeed, and `brew tap` no longer lists `fredrikhaugen/tap`.

- [ ] **Step 3: Install it as a user would**

Run: `brew tap fredrikhaugen/tap && brew install wake`, then `brew info wake`, `wake --help` and `brew test wake`
Expected:
- The install downloads the archive and verifies the checksum.
- `brew info` shows `From: https://github.com/FredrikHaugen/homebrew-tap/blob/HEAD/Formula/wake.rb`.
- `wake --help` prints the usage text, and `brew test wake` passes.

- [ ] **Step 4: Report the install line**

Write this in the report: users install with `brew tap fredrikhaugen/tap` then `brew install wake`, and upgrade with `brew upgrade wake` once a new version's formula is pushed.
