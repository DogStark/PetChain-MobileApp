# Security Workflows Documentation

This document describes the GitHub Actions workflows for security scanning and automated patch management.

## Workflows Overview

### 1. security-audit.yml

**Purpose:** Automated dependency vulnerability scanning on every PR and daily on main.

**File Location:** `.github/workflows/security-audit.yml`

**Triggers:**
- Push to main, master, develop branches
- Pull requests to main, master, develop branches
- Daily schedule at 2 AM UTC

**Jobs:**

#### npm-audit
- Runs `npm audit --audit-level=moderate`
- Generates JSON report
- Parses results and extracts severity counts
- Comments on PR with summary
- **Blocks PR if critical or high vulnerabilities found**
- Uploads report as artifact

**Outputs:**
- `npm-audit-report.json` — Full audit report
- PR comment with vulnerability summary
- GitHub Step Summary with counts

#### snyk-scan
- Runs Snyk vulnerability scan
- Requires `SNYK_TOKEN` secret
- Generates JSON report
- Comments on PR with results
- Skipped on scheduled runs to avoid rate limits

**Outputs:**
- `snyk-report.json` — Snyk scan results
- PR comment with vulnerability summary

#### security-report
- Generates markdown security report
- Includes vulnerability counts and recommendations
- Comments on PR with full report
- Uploads report as artifact

**Outputs:**
- `security-report.md` — Formatted security report
- PR comment with recommendations

**Environment Variables:**
- `SNYK_TOKEN` — Required for Snyk scan (GitHub Secret)

**Permissions:**
- `contents: read` — Read repository contents
- `security-events: write` — Write security events
- `pull-requests: write` — Comment on PRs
- `issues: write` — Create issues

---

### 2. security-patches.yml

**Purpose:** Automatically create PRs for available security patches.

**File Location:** `.github/workflows/security-patches.yml`

**Triggers:**
- Daily schedule at 3 AM UTC
- Manual trigger via `workflow_dispatch`

**Jobs:**

#### check-patches
- Runs `npm outdated` to find available updates
- Runs `npm audit fix --dry-run` to check for patches
- Counts available updates and security patches
- Determines if patches are available

**Outputs:**
- `outdated.json` — List of outdated packages
- `audit-fix-dry.json` — Dry-run results
- Job output: `has-patches` (true/false)

#### create-patch-pr
- Runs only if patches are available
- Creates new branch: `chore/security-patches-YYYYMMDD-HHMMSS`
- Runs `npm audit fix` to apply patches
- Commits changes with detailed message
- Pushes branch and creates PR
- Adds labels: `security`, `dependencies`, `automated`
- Includes PR description with:
  - Number of fixed vulnerabilities
  - Number of removed packages
  - Reference to issue #59
  - Checklist for reviewers

**Outputs:**
- New branch with security patches applied
- PR with detailed description
- `audit-fix-result.json` — Audit fix results

**Commit Message Format:**
```
chore: apply security patches via npm audit fix

- Fixed X vulnerabilities
- Removed Y packages
- Closes #59
```

**PR Description:**
- Summary of changes
- Number of vulnerabilities fixed
- Reviewer checklist
- Link to issue #59

---

### 3. dependabot.yml

**Purpose:** Automated dependency updates and patch creation.

**File Location:** `.github/dependabot.yml`

**Configuration:**

#### npm Updates
- **Schedule:** Weekly on Mondays at 3 AM UTC
- **Open PRs Limit:** 5 concurrent PRs
- **Reviewers:** DogStark (update as needed)
- **Assignees:** DogStark (update as needed)
- **Labels:** `dependencies`, `security`
- **Commit Prefix:** `chore(deps):`
- **Rebase Strategy:** Auto
- **Versioning:** Auto

**Ignored Updates:**
- React Native major versions
- Expo major versions

#### GitHub Actions Updates
- **Schedule:** Weekly on Mondays at 4 AM UTC
- **Open PRs Limit:** 5 concurrent PRs
- **Reviewers:** DogStark (update as needed)
- **Labels:** `ci-cd`, `github-actions`
- **Commit Prefix:** `ci(actions):`
- **Rebase Strategy:** Auto

---

## Workflow Execution Flow

### On Pull Request

```
1. PR created
   ↓
2. security-audit.yml triggered
   ├─ npm-audit job
   │  ├─ Run npm audit
   │  ├─ Parse results
   │  ├─ Comment on PR
   │  └─ Block if critical/high found
   ├─ snyk-scan job (if SNYK_TOKEN set)
   │  ├─ Run Snyk scan
   │  ├─ Parse results
   │  └─ Comment on PR
   └─ security-report job
      ├─ Generate report
      └─ Comment on PR
   ↓
3. Other CI jobs (lint, tests, etc.)
   ↓
4. All checks must pass to merge
```

### Daily Security Patch Check

```
1. Scheduled trigger (3 AM UTC)
   ↓
2. security-patches.yml triggered
   ├─ check-patches job
   │  ├─ Run npm outdated
   │  ├─ Run npm audit fix --dry-run
   │  └─ Determine if patches available
   └─ create-patch-pr job (if patches found)
      ├─ Create branch
      ├─ Run npm audit fix
      ├─ Commit changes
      ├─ Push branch
      └─ Create PR
   ↓
3. PR created with security patches
   ↓
4. CI runs on new PR
   ↓
5. Team reviews and merges
```

### Weekly Dependency Updates

```
1. Scheduled trigger (Mondays 3 AM UTC)
   ↓
2. Dependabot checks for updates
   ├─ npm packages
   └─ GitHub Actions
   ↓
3. For each update:
   ├─ Create branch
   ├─ Update package.json/package-lock.json
   ├─ Create PR
   ├─ Assign to reviewers
   └─ Add labels
   ↓
4. CI runs on each PR
   ↓
5. Team reviews and merges
```

---

## PR Blocking Logic

### npm-audit Job

PRs are blocked if:
- Critical severity vulnerabilities > 0, OR
- High severity vulnerabilities > 0

**Exit Code:** 1 (failure)

**Message:** "PR blocked: Found X critical and Y high severity vulnerabilities"

### Branch Protection

Main branch requires:
- ✅ npm audit — Dependency Vulnerabilities (must pass)
- ✅ Lint, Format & Typecheck (must pass)
- ✅ Unit & Integration Tests (must pass)
- ✅ Code review approval
- ✅ Up-to-date with base branch

---

## Artifact Retention

All security reports are uploaded as artifacts with 30-day retention:

- `npm-audit-report.json` — 30 days
- `snyk-report.json` — 30 days
- `security-report.md` — 90 days
- `outdated-packages.json` — 30 days
- `audit-fix-result.json` — 30 days

**Access:** Actions → Workflow Run → Artifacts

---

## Environment Variables & Secrets

### Required Secrets

| Secret | Workflow | Purpose |
|--------|----------|---------|
| `SNYK_TOKEN` | security-audit.yml | Snyk API authentication |

### Optional Secrets

| Secret | Workflow | Purpose |
|--------|----------|---------|
| `SLACK_WEBHOOK_URL` | security-audit.yml | Slack notifications |
| `GITHUB_TOKEN` | All | GitHub API access (auto-provided) |

### How to Add Secrets

1. Go to **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Enter name and value
4. Click **Add secret**

---

## Monitoring & Debugging

### View Workflow Runs

1. Go to **Actions** tab
2. Select workflow name
3. Click run to view details
4. Check logs for each job

### Common Issues

#### Workflow Not Triggering

**Check:**
1. Workflow file syntax (YAML)
2. Branch name matches trigger
3. GitHub Actions enabled
4. Workflow not disabled

#### npm audit Fails

**Check:**
1. Node.js version (should be 20+)
2. npm version (should be 10+)
3. package.json syntax
4. package-lock.json in sync

#### Snyk Scan Fails

**Check:**
1. `SNYK_TOKEN` is set and valid
2. Token has correct permissions
3. Snyk account is active
4. No rate limiting

#### PR Not Blocking

**Check:**
1. Branch protection rules configured
2. Status check name matches exactly
3. Workflow permissions set correctly
4. Required checks enabled

---

## Performance Optimization

### Caching

All workflows use npm cache:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 20
    cache: npm
```

This caches `node_modules` and speeds up subsequent runs.

### Concurrency

Workflows use concurrency groups to cancel in-progress runs:

```yaml
concurrency:
  group: security-audit-${{ github.ref }}
  cancel-in-progress: true
```

This prevents duplicate runs on the same branch.

### Conditional Execution

Some jobs run conditionally:

```yaml
if: github.event_name == 'pull_request'
if: always()  # Run even if previous job failed
if: needs.check-patches.outputs.has-patches == 'true'
```

---

## Customization

### Modify Audit Level

Edit `security-audit.yml`:

```yaml
run: npm audit --audit-level=high  # Change from moderate to high
```

### Change Schedule

Edit workflow file:

```yaml
schedule:
  - cron: '0 2 * * *'  # Change time (UTC)
```

Cron format: `minute hour day month day-of-week`

### Update Reviewers

Edit `.github/dependabot.yml`:

```yaml
reviewers:
  - username1
  - username2
```

### Customize PR Labels

Edit `.github/dependabot.yml`:

```yaml
labels:
  - custom-label
  - another-label
```

---

## Related Documentation

- [SECURITY.md](../SECURITY.md) — Security policies and procedures
- [SECURITY-SETUP.md](./SECURITY-SETUP.md) — Setup and configuration guide
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [npm audit Documentation](https://docs.npmjs.com/cli/v10/commands/npm-audit)

---

**Last Updated:** May 28, 2026
**Maintained By:** PetChain Security Team
