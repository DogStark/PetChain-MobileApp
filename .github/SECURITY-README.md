# 🔒 Security Scanning & Automated Patch Management

This directory contains GitHub Actions workflows and configurations for automated dependency vulnerability scanning, security patch management, and compliance reporting.

## Quick Start

### For Developers

1. **Run security checks locally:**
   ```bash
   npm run security:check
   ```

2. **Fix vulnerabilities:**
   ```bash
   npm audit fix
   ```

3. **Review security documentation:**
   - [SECURITY.md](../docs/SECURITY.md) — Security policies and procedures
   - [SECURITY-SETUP.md](../docs/SECURITY-SETUP.md) — Setup and configuration guide
   - [SECURITY-WORKFLOWS.md](./SECURITY-WORKFLOWS.md) — Workflow documentation

### For Security Team

1. **Monitor security alerts:**
   - GitHub Security tab
   - Dependabot alerts
   - Snyk dashboard

2. **Review weekly reports:**
   - Check Actions artifacts
   - Review PR comments
   - Monitor Slack notifications

3. **Respond to vulnerabilities:**
   - Use private vulnerability reporting
   - Email security@petchain.app
   - Follow incident response procedures

## Files Overview

### Workflows

| File | Purpose | Trigger |
|------|---------|---------|
| `workflows/security-audit.yml` | npm audit + Snyk scanning | Every PR, daily on main |
| `workflows/security-patches.yml` | Auto-create PRs for patches | Daily at 3 AM UTC |
| `workflows/ci.yml` | Lint, tests, security check | Every PR and push |
| `dependabot.yml` | Automated dependency updates | Weekly |

### Documentation

| File | Purpose |
|------|---------|
| `SECURITY-README.md` | This file — overview and quick start |
| `SECURITY-WORKFLOWS.md` | Detailed workflow documentation |
| `../docs/SECURITY.md` | Security policies and procedures |
| `../docs/SECURITY-SETUP.md` | Setup and configuration guide |

### Issue Templates

| File | Purpose |
|------|---------|
| `ISSUE_TEMPLATE/security-vulnerability.md` | Report vulnerabilities |
| `ISSUE_TEMPLATE/security-patch.md` | Track security patches |

## Workflow Summary

### 1. security-audit.yml

**Automated dependency vulnerability scanning**

- Runs on every PR and daily on main
- Uses npm audit and Snyk
- Blocks PRs with critical/high vulnerabilities
- Comments on PRs with detailed reports
- Uploads artifacts for analysis

**Key Features:**
- ✅ npm audit scanning
- ✅ Snyk advanced scanning
- ✅ PR blocking on critical/high
- ✅ Automated PR comments
- ✅ Security reports

### 2. security-patches.yml

**Automatically create PRs for security patches**

- Runs daily at 3 AM UTC
- Detects available patches
- Creates PR with npm audit fix applied
- Includes detailed commit message
- References issue #59

**Key Features:**
- ✅ Automatic patch detection
- ✅ PR auto-creation
- ✅ Detailed commit messages
- ✅ Proper labeling
- ✅ Reviewer assignment

### 3. dependabot.yml

**Automated dependency updates**

- Weekly npm package updates
- Weekly GitHub Actions updates
- Auto-creates PRs
- Assigns to reviewers
- Includes changelog

**Key Features:**
- ✅ Weekly updates
- ✅ Auto PR creation
- ✅ Reviewer assignment
- ✅ Proper labeling
- ✅ Rebase strategy

### 4. ci.yml (Updated)

**Integrated security checks in CI pipeline**

- Runs npm audit as part of CI
- Blocks PRs with high severity vulnerabilities
- Runs alongside lint, tests, typecheck

**Key Features:**
- ✅ Security audit in CI
- ✅ Integrated with other checks
- ✅ Consistent enforcement

## PR Blocking Logic

PRs are blocked if:

1. **npm audit finds:**
   - Critical severity vulnerabilities > 0, OR
   - High severity vulnerabilities > 0

2. **Branch protection requires:**
   - All status checks pass
   - Code review approval
   - Up-to-date with base branch

## Setup Checklist

- [ ] GitHub Actions enabled
- [ ] Snyk account created (optional)
- [ ] SNYK_TOKEN added to GitHub Secrets (if using Snyk)
- [ ] Dependabot configured in `.github/dependabot.yml`
- [ ] Branch protection rules configured
- [ ] Reviewers updated in dependabot.yml
- [ ] Team notified of new workflows
- [ ] Security documentation reviewed

## Environment Variables & Secrets

### Required

| Secret | Workflow | Purpose |
|--------|----------|---------|
| `GITHUB_TOKEN` | All | GitHub API access (auto-provided) |

### Optional

| Secret | Workflow | Purpose |
|--------|----------|---------|
| `SNYK_TOKEN` | security-audit.yml | Snyk API authentication |
| `SLACK_WEBHOOK_URL` | security-audit.yml | Slack notifications |

## Monitoring & Alerts

### GitHub Notifications

- PR comments with vulnerability summaries
- Status check failures
- Branch protection blocks

### Artifacts

- `npm-audit-report.json` — Full npm audit results
- `snyk-report.json` — Snyk scan results
- `security-report.md` — Summary report
- `outdated-packages.json` — Outdated packages list
- `audit-fix-result.json` — Patch application results

### Slack Integration (Optional)

Configure Slack notifications for:
- Security audit failures
- Critical vulnerabilities detected
- Patch PR creation
- Merge notifications

## Common Tasks

### Run Security Checks Locally

```bash
# Check for vulnerabilities
npm run audit

# Check for high severity only
npm run audit:high

# Fix vulnerabilities
npm run audit:fix

# Full security check
npm run security:check
```

### View Security Reports

1. Go to **Actions** tab
2. Select **Security — Dependency Audit & Vulnerability Scanning**
3. Click latest run
4. Download artifacts

### Update Reviewers

Edit `.github/dependabot.yml`:

```yaml
reviewers:
  - username1
  - username2
```

### Customize Schedule

Edit workflow files:

```yaml
schedule:
  - cron: '0 2 * * *'  # Change time (UTC)
```

### Ignore Vulnerabilities

Document in `docs/SECURITY.md`:

```markdown
## Accepted Risk: [CVE-XXXX-XXXXX]

**Package:** [package-name]
**Severity:** [Critical/High/Moderate]
**Reason:** [Explanation]
**Mitigation:** [Compensating controls]
**Review Date:** [Date]
```

## Troubleshooting

### Snyk Scan Fails

- Verify `SNYK_TOKEN` is set in GitHub Secrets
- Check token is valid in Snyk dashboard
- Ensure token has correct permissions

### npm audit Reports False Positives

- Check vulnerability details
- Verify it doesn't affect your code
- Document as accepted risk

### Dependabot PRs Not Creating

- Check `.github/dependabot.yml` syntax
- Verify Dependabot is enabled
- Wait for next scheduled run

### Branch Protection Blocking Merges

- Review security report in PR
- Fix vulnerabilities: `npm audit fix`
- Commit and push changes
- Wait for CI to re-run

## Best Practices

1. **Review Dependencies** — Regularly audit package.json
2. **Keep Updated** — Merge Dependabot PRs promptly
3. **Test Thoroughly** — Always run full test suite
4. **Document Risks** — Keep SECURITY.md updated
5. **Monitor Alerts** — Check GitHub security alerts weekly
6. **Communicate** — Notify team of critical vulnerabilities

## Related Documentation

- [SECURITY.md](../docs/SECURITY.md) — Security policies
- [SECURITY-SETUP.md](../docs/SECURITY-SETUP.md) — Setup guide
- [SECURITY-WORKFLOWS.md](./SECURITY-WORKFLOWS.md) — Workflow details
- [GitHub Actions Docs](https://docs.github.com/en/actions)
- [npm audit Docs](https://docs.npmjs.com/cli/v10/commands/npm-audit)
- [Snyk Docs](https://docs.snyk.io/)

## Support

For questions or issues:

1. Check documentation above
2. Review GitHub Actions logs
3. Contact security@petchain.app
4. Open issue with `security` label

---

## Implementation Summary

### What Was Implemented

✅ **npm audit Integration**
- Runs on every PR and daily on main
- Blocks PRs with critical/high vulnerabilities
- Generates detailed reports

✅ **Snyk Integration**
- Advanced vulnerability scanning
- Threat intelligence
- Remediation guidance

✅ **Dependabot Configuration**
- Weekly npm package updates
- Weekly GitHub Actions updates
- Auto PR creation

✅ **Security Patch Automation**
- Daily patch detection
- Auto PR creation with npm audit fix
- Detailed commit messages

✅ **Documentation**
- Security policies (SECURITY.md)
- Setup guide (SECURITY-SETUP.md)
- Workflow documentation (SECURITY-WORKFLOWS.md)
- Issue templates for vulnerabilities

✅ **CI/CD Integration**
- Security checks in main CI pipeline
- PR blocking on vulnerabilities
- Artifact uploads for analysis

### Key Features

- 🔒 Automated vulnerability scanning
- 🚫 PR blocking on critical/high vulnerabilities
- 🤖 Automated patch creation
- 📊 Detailed security reports
- 📧 PR comments with summaries
- 🔄 Weekly dependency updates
- 📝 Comprehensive documentation
- 🎯 Issue templates for tracking

### Closes Issue

- Closes #59

---

**Last Updated:** May 28, 2026
**Maintained By:** PetChain Security Team
